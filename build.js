// 构建脚本：读取环境变量并替换 wrangler.toml 中的占位符
const fs = require('fs');

try {
    console.log('🚀 开始构建过程...');
    console.log('📋 环境变量检查:');

    // 检查关键环境变量（不打印值）
    console.log('\n🔑 关键变量状态:');
    console.log('- USER_AGENT_LIMITS_CONFIG:', process.env.USER_AGENT_LIMITS_CONFIG ? '已设置 (已隐藏)' : '未设置，使用默认值');
    console.log('- IP_BLACKLIST_CONFIG:', process.env.IP_BLACKLIST_CONFIG ? '已设置 (已隐藏)' : '未设置，使用默认值');
    console.log('- TG_BOT_TOKEN:', process.env.TG_BOT_TOKEN ? '已设置 (已隐藏)' : '未设置，TG机器人将不可用');
    console.log('- TG_ADMIN_USER_ID:', process.env.TG_ADMIN_USER_ID ? '已设置 (已隐藏)' : '未设置，TG机器人将不可用');
    console.log('- WORKER_DOMAIN:', process.env.WORKER_DOMAIN ? '已设置 (已隐藏)' : '未设置，Webhook自动设置将不可用');
  
    // 读取 wrangler.toml 文件
    console.log('\n📝 读取 wrangler.toml...');
    let config = fs.readFileSync('wrangler.toml', 'utf8');

    // 替换占位符
    console.log('🔄 替换占位符...');
    config = config.replace('{{USER_AGENT_LIMITS_CONFIG}}', process.env.USER_AGENT_LIMITS_CONFIG || '{}');
    config = config.replace('{{IP_BLACKLIST_CONFIG}}', process.env.IP_BLACKLIST_CONFIG || '[]');
    config = config.replace('{{TG_BOT_TOKEN}}', process.env.TG_BOT_TOKEN || '');
    config = config.replace('{{TG_ADMIN_USER_ID}}', process.env.TG_ADMIN_USER_ID || '');
    config = config.replace('{{WORKER_DOMAIN}}', process.env.WORKER_DOMAIN || '');

    // 写回文件
    console.log('💾 写入配置文件...');
    fs.writeFileSync('wrangler.toml', config);

    console.log('✅ wrangler.toml 占位符替换完成');
    console.log('🎯 准备开始 Worker 部署...\n');

} catch (error) {
    console.error('❌ 构建脚本执行失败:', error);
    process.exit(1);
}
