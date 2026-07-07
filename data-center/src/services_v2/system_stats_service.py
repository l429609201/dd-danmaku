"""
系统资源监控服务：采集当前进程 + 整机的 CPU / 内存占用。

用于仪表盘实时展示。依赖 psutil（已在 requirements/base.txt）。
psutil 缺失时降级返回 available=False，不阻断接口。
"""
import logging
import os

logger = logging.getLogger(__name__)

try:
    import psutil
except Exception:  # pragma: no cover - psutil 未安装时降级
    psutil = None

# 进程句柄单例：cpu_percent 需要两次采样间隔才能算出占用，
# 维持同一个 Process 对象跨请求复用，配合固定 interval 采样。
_proc = None


def _get_proc():
    global _proc
    if psutil is None:
        return None
    if _proc is None:
        _proc = psutil.Process(os.getpid())
        # 首次调用建立基线，返回值丢弃（否则第一次恒为 0）
        try:
            _proc.cpu_percent(interval=None)
        except Exception:
            pass
    return _proc


def collect_system_stats() -> dict:
    """采集进程与整机的 CPU / 内存指标（同步阻塞，调用方放线程池）。

    返回结构：
    {
      available: bool,
      cpu: { system_percent, process_percent, cores },
      memory: { system_total, system_used, system_percent,
                process_rss, process_percent }
    }
    """
    if psutil is None:
        return {"available": False, "note": "psutil 未安装"}
    try:
        # 整机 CPU：interval=0.3 做一次短采样，保证数值有意义
        system_cpu = psutil.cpu_percent(interval=0.3)
        cores = psutil.cpu_count(logical=True) or 1

        # 进程 CPU：基于上次调用到本次的间隔计算
        proc = _get_proc()
        proc_cpu = 0.0
        proc_rss = 0
        proc_mem_pct = 0.0
        if proc is not None:
            try:
                # 归一化到单核：psutil 进程 CPU 可能 >100%（多核），
                # 除以核数得到"整机占比"，与整机 CPU 口径一致
                raw = proc.cpu_percent(interval=None)
                proc_cpu = round(raw / cores, 1)
                mem = proc.memory_info()
                proc_rss = int(mem.rss)
                proc_mem_pct = round(proc.memory_percent(), 1)
            except Exception:
                pass

        vm = psutil.virtual_memory()
        return {
            "available": True,
            "cpu": {
                "system_percent": round(system_cpu, 1),
                "process_percent": proc_cpu,
                "cores": cores,
            },
            "memory": {
                "system_total": int(vm.total),
                "system_used": int(vm.used),
                "system_percent": round(vm.percent, 1),
                "process_rss": proc_rss,
                "process_percent": proc_mem_pct,
            },
        }
    except Exception as e:
        logger.warning(f"⚠️ 系统资源采集失败: {e}")
        return {"available": False, "error": str(e)}
