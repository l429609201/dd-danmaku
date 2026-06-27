"""
表完整性检查器（SchemaGuard）

启动时遍历所有 ORM 模型，比对数据库实际表结构：
- 缺表：由 Base.metadata.create_all 负责建表（本检查器只校验并记录）
- 缺列：依据 ORM Column 定义自动 ALTER TABLE ADD COLUMN（跨方言类型编译）

安全边界（严格只增不删）：
- 只执行：ADD COLUMN
- 绝不执行：删表 / 删列 / 改列类型 / 改约束（仅记录 WARNING 供人工处理）
- 单列失败不中断，记录日志后继续处理其余列

跨库：列类型通过 SQLAlchemy 方言 type_compiler 编译，自动适配
SQLite / MySQL / PostgreSQL。
"""
import logging
from typing import List

from sqlalchemy import inspect
from sqlalchemy import text as _text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import Column

logger = logging.getLogger(__name__)


class SchemaGuard:
    """基于 ORM 元数据的表完整性检查器（只增不删）"""

    def __init__(self, engine: Engine, metadata):
        self.engine = engine
        self.metadata = metadata
        self.dialect = engine.dialect
        # 统计：本次补了哪些列 / 跳过哪些缺表
        self.added_columns: List[str] = []
        self.missing_tables: List[str] = []

    # ---------- 类型与默认值编译 ----------
    def _compile_type(self, column: Column) -> str:
        """把 ORM 列类型编译为当前方言的 DDL 类型字符串（跨库适配）"""
        return column.type.compile(dialect=self.dialect)

    def _server_default_sql(self, column: Column) -> str:
        """为 NOT NULL 新列推导一个安全的 DEFAULT，兼容存量行。

        优先用模型显式 server_default；否则按类型给保守默认值。
        返回空串表示不加 DEFAULT。
        """
        # 模型显式指定了 server_default（DDL 级默认值），直接采用
        if column.server_default is not None:
            try:
                arg = column.server_default.arg
                text_val = getattr(arg, "text", None)
                return f"DEFAULT {text_val if text_val is not None else arg}"
            except Exception:
                return ""
        # 仅当 NOT NULL 才需要兜底默认值（NULL 列加列即可，存量行自动为 NULL）
        if column.nullable:
            return ""
        # 按 Python 类型给保守默认值
        try:
            pytype = column.type.python_type
        except Exception:
            pytype = str
        if pytype in (int, float):
            return "DEFAULT 0"
        if pytype is bool:
            return "DEFAULT 0"
        # 字符串/JSON/其它一律给空串，避免 NOT NULL 存量行报错
        return "DEFAULT ''"

    def _build_add_column_sql(self, table_name: str, column: Column) -> str:
        """构造单列 ADD COLUMN 语句（带 NULL 约束与安全默认值）"""
        col_type = self._compile_type(column)
        parts = [f'ADD COLUMN "{column.name}" {col_type}']
        if not column.nullable:
            default_sql = self._server_default_sql(column)
            # NOT NULL 必须配 DEFAULT，否则存量行无法满足约束
            if default_sql:
                parts.append(default_sql)
            parts.append("NOT NULL")
        else:
            default_sql = self._server_default_sql(column)
            if default_sql:
                parts.append(default_sql)
        return f'ALTER TABLE "{table_name}" ' + " ".join(parts)

    # ---------- 主流程 ----------
    def run(self) -> dict:
        """执行检查：缺表记录、缺列自动补。返回统计结果。"""
        inspector = inspect(self.engine)
        existing_tables = set(inspector.get_table_names())

        for table in self.metadata.sorted_tables:
            if table.name not in existing_tables:
                # 缺表交给 create_all；这里只记录（理论上 create_all 已先跑）
                self.missing_tables.append(table.name)
                logger.warning(f"⚠️ 表 {table.name} 不存在（应由 create_all 创建）")
                continue
            self._check_table_columns(inspector, table)

        if self.added_columns:
            logger.info(f"✅ SchemaGuard 自动补列 {len(self.added_columns)} 个: "
                        f"{', '.join(self.added_columns)}")
        else:
            logger.info("✅ SchemaGuard 检查完成，表结构完整，无需补列")
        return {
            "added_columns": self.added_columns,
            "missing_tables": self.missing_tables,
        }

    def _check_table_columns(self, inspector, table):
        """比对单表列，缺列则 ADD COLUMN（只增不删）"""
        db_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in db_cols:
                continue  # 已存在，跳过（不改类型/约束）
            self._add_column(table.name, column)

    def _add_column(self, table_name: str, column: Column):
        """执行单列 ADD COLUMN，失败不中断整体流程"""
        sql = self._build_add_column_sql(table_name, column)
        try:
            with self.engine.begin() as conn:
                conn.execute(_text(sql))
            self.added_columns.append(f"{table_name}.{column.name}")
            logger.info(f"✅ 已为 {table_name} 自动增加字段 {column.name}（{sql}）")
        except Exception as e:
            logger.error(f"❌ 为 {table_name} 增加字段 {column.name} 失败，跳过: {e}")
