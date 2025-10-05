// 构建脚本：读取环境变量并替换 wrangler.toml 中的占位符
const fs = require('fs');

try {
    console.log('🚀 开始构建过程...');
    console.log('📋 环境变量检查:');

    // 检查关键环境变量（不打印值）
    console.log('\n🔑 关键变量状态:');
    console.log('- USER_AGENT_LIMITS_CONFIG:', process.env.USER_AGENT_LIMITS_CONFIG ? '已设置 (已隐藏)' : '未设置，使用默认值');
    console.log('- IP_BLACKLIST_CONFIG:', process.env.IP_BLACKLIST_CONFIG ? '已设置 (已隐藏)' : '未设置，使用默认值');
    console.log('- DATA_CENTER_URL:', process.env.DATA_CENTER_URL ? '已设置 (已隐藏)' : '未设置，数据中心集成将不可用');
    console.log('- DATA_CENTER_API_KEY:', process.env.DATA_CENTER_API_KEY ? '已设置 (已隐藏)' : '未设置，数据中心集成将不可用');
    console.log('- WORKER_ID:', process.env.WORKER_ID ? '已设置 (已隐藏)' : '未设置，使用默认值');
    console.log('- ENABLE_ASYMMETRIC_AUTH_ENV:', process.env.ENABLE_ASYMMETRIC_AUTH_ENV ? '已设置 (已隐藏)' : '未设置，使用默认值');
    console.log('- ENABLE_DETAILED_LOGGING:', process.env.ENABLE_DETAILED_LOGGING ? '已设置 (已隐藏)' : '未设置，使用默认值');
    console.log('- PRIVATE_KEY_HEX:', process.env.PRIVATE_KEY_HEX ? '已设置 (已隐藏)' : '未设置，非对称认证将不可用');

    // 读取 wrangler.toml 文件
    console.log('\n📝 读取 wrangler.toml...');
    let config = fs.readFileSync('wrangler.toml', 'utf8');

    // 替换占位符
    console.log('🔄 替换占位符...');
    config = config.replace('{{USER_AGENT_LIMITS_CONFIG}}', process.env.USER_AGENT_LIMITS_CONFIG || '{}');
    config = config.replace('{{IP_BLACKLIST_CONFIG}}', process.env.IP_BLACKLIST_CONFIG || '[]');
    config = config.replace('{{DATA_CENTER_URL}}', process.env.DATA_CENTER_URL || '');
    config = config.replace('{{DATA_CENTER_API_KEY}}', process.env.DATA_CENTER_API_KEY || '');
    config = config.replace('{{WORKER_ID}}', process.env.WORKER_ID || 'worker-1');
    config = config.replace('{{ENABLE_ASYMMETRIC_AUTH_ENV}}', process.env.ENABLE_ASYMMETRIC_AUTH_ENV || 'false');
    config = config.replace('{{ENABLE_DETAILED_LOGGING}}', process.env.ENABLE_DETAILED_LOGGING || 'true');
    config = config.replace('{{PRIVATE_KEY_HEX}}', process.env.PRIVATE_KEY_HEX || '');

    // 写回文件
    console.log('💾 写入配置文件...');
    fs.writeFileSync('wrangler.toml', config);

    console.log('✅ wrangler.toml 占位符替换完成');
    console.log('🎯 准备开始 Worker 部署...\n');

} catch (error) {
    console.error('❌ 构建脚本执行失败:', error);
    process.exit(1);
}
