#!/usr/bin/env python3
"""
密码重置工具 - 容器内使用
用法：
  python -m src.utils.reset_password <username> [new_password]
  
示例：
  python -m src.utils.reset_password admin
  python -m src.utils.reset_password admin MyNewPass123
"""
import sys
import os
import secrets
import string

# 添加项目根目录到Python路径
sys.path.insert(0, '/app')

def generate_random_password(length: int = 12) -> str:
    """生成随机密码"""
    characters = string.ascii_letters + string.digits + "!@#$%^&*"
    password = ''.join(secrets.choice(characters) for _ in range(length))
    return password

def reset_password(username: str, new_password: str = None):
    """重置用户密码"""
    try:
        # 导入必要的模块
        from src.database import get_db_sync
        from src.models_v2 import LocalUser as User
        
        # 如果没有提供密码，生成随机密码
        if not new_password:
            new_password = generate_random_password()
            print(f"🔑 生成随机密码: {new_password}")
        
        # 获取数据库连接
        db = get_db_sync()
        
        # 查找用户
        user = db.query(User).filter(User.username == username).first()
        
        if not user:
            print(f"❌ 用户不存在: {username}")
            db.close()
            return False
        
        # 重置密码
        user.set_password(new_password)
        db.commit()
        db.close()
        
        print(f"✅ 密码重置成功！")
        print(f"")
        print(f"用户名: {username}")
        print(f"新密码: {new_password}")
        print(f"")
        print(f"请妥善保存密码，建议登录后立即修改。")
        
        return True
        
    except Exception as e:
        print(f"❌ 密码重置失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法: python -m src.utils.reset_password <username> [new_password]")
        print("")
        print("示例:")
        print("  python -m src.utils.reset_password admin")
        print("  python -m src.utils.reset_password admin MyNewPass123")
        sys.exit(1)
    
    username = sys.argv[1]
    new_password = sys.argv[2] if len(sys.argv) > 2 else None
    
    print(f"🔄 正在重置用户密码: {username}")
    print("")
    
    success = reset_password(username, new_password)
    
    if success:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()

