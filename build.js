// 构建脚本：读取环境变量并替换 wrangler.toml 中的占位符
const fs = require('fs');

try {
    console.log('🚀 开始构建过程...');
    console.log('📋 环境变量检查:');

    // 检查关键环境变量（不打印值）
    console.log('\n🔑 关键变量状态:');
    console.log('- USER_AGENT_LIMITS_CONFIG:', process.env.USER_AGENT_LIMITS_CONFIG ? '已设置 (已隐藏)' : '未设置，使用默认值');

    // 读取 wrangler.toml 文件
    console.log('\n📝 读取 wrangler.toml...');
    let config = fs.readFileSync('wrangler.toml', 'utf8');

    // 替换占位符
    console.log('🔄 替换占位符...');
    config = config.replace('{{USER_AGENT_LIMITS_CONFIG}}', process.env.USER_AGENT_LIMITS_CONFIG || '{}');

    // 写回文件
    console.log('💾 写入配置文件...');
    fs.writeFileSync('wrangler.toml', config);

    console.log('✅ wrangler.toml 占位符替换完成');
    console.log('🎯 准备开始 Worker 部署...\n');

} catch (error) {
    console.error('❌ 构建脚本执行失败:', error);
    process.exit(1);
}
