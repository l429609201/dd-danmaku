# Worker集成说明

## Worker端需要的环境变量

```bash
# 数据交互中心配置
DATA_CENTER_URL=http://localhost:7759
DATA_CENTER_API_KEY=your-secret-api-key-here

# 其他现有配置保持不变
USER_AGENT_LIMITS_CONFIG=...
IP_BLACKLIST_CONFIG=...
```

## Worker端需要实现的功能

### 1. 启动时配置同步
```javascript
async function initializeConfig() {
  try {
    const response = await fetch(`${DATA_CENTER_URL}/api/v1/config/export`, {
      headers: { 'X-API-Key': DATA_CENTER_API_KEY }
    });
    
    if (response.ok) {
      const config = await response.json();
      global.UA_CONFIGS = config.ua_configs;
      global.IP_BLACKLIST = config.ip_blacklist;
      console.log('✅ 配置从数据交互中心加载成功');
    }
  } catch (error) {
    console.log('⚠️ 从数据交互中心加载配置失败，使用环境变量默认配置');
    loadDefaultConfigFromEnv();
  }
}
```

### 2. API密钥验证中间件
```javascript
function verifyApiKey(request) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || apiKey !== DATA_CENTER_API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}
```

### 3. 配置更新端点
```javascript
app.post('/api/config/update', async (request) => {
  // 验证API密钥
  const authError = verifyApiKey(request);
  if (authError) return authError;
  
  const config = await request.json();
  
  // 更新配置
  global.UA_CONFIGS = config.ua_configs;
  global.IP_BLACKLIST = config.ip_blacklist;
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

### 4. 统计数据导出端点
```javascript
app.get('/api/stats/export', async (request) => {
  // 验证API密钥
  const authError = verifyApiKey(request);
  if (authError) return authError;
  
  return new Response(JSON.stringify({
    worker_id: WORKER_ID,
    timestamp: new Date().toISOString(),
    stats: {
      total_requests: globalStats.totalRequests,
      blocked_requests: globalStats.blockedRequests,
      ua_stats: globalStats.uaStats,
      ip_stats: globalStats.ipStats
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

### 5. 健康检查端点
```javascript
app.get('/health', async (request) => {
  // 验证API密钥
  const authError = verifyApiKey(request);
  if (authError) return authError;
  
  return new Response(JSON.stringify({
    status: 'healthy',
    worker_id: WORKER_ID,
    timestamp: new Date().toISOString(),
    uptime: Date.now() - startTime
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

## 数据交互中心API端点

### 配置导出
- `GET /api/v1/config/export` - 导出Worker配置
- 需要 `X-API-Key` 头部验证

### 统计数据接收
- `POST /api/v1/stats/receive` - 接收Worker统计数据
- 需要 `X-API-Key` 头部验证

### 配置推送
- `POST /api/v1/sync/push-config` - 推送配置到所有Worker
- 需要 `X-API-Key` 头部验证

### Worker健康检查
- `GET /api/v1/sync/health-check` - 检查Worker健康状态
- 需要 `X-API-Key` 头部验证
