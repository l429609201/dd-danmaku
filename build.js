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

    // 安全替换函数，处理特殊字符
    function safeReplace(str, placeholder, value) {
        // 对于多行字符串值，确保正确转义
        if (placeholder.includes('CONFIG')) {
            return str.replace(placeholder, value || (placeholder.includes('BLACKLIST') ? '[]' : '{}'));
        }
        // 对于普通字符串值，转义引号
        const escapedValue = (value || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
        return str.replace(placeholder, escapedValue);
    }

    config = safeReplace(config, '{{USER_AGENT_LIMITS_CONFIG}}', process.env.USER_AGENT_LIMITS_CONFIG);
    config = safeReplace(config, '{{IP_BLACKLIST_CONFIG}}', process.env.IP_BLACKLIST_CONFIG);
    config = safeReplace(config, '{{DATA_CENTER_URL}}', process.env.DATA_CENTER_URL);
    config = safeReplace(config, '{{DATA_CENTER_API_KEY}}', process.env.DATA_CENTER_API_KEY);
    config = safeReplace(config, '{{WORKER_ID}}', process.env.WORKER_ID || 'worker-1');
    config = safeReplace(config, '{{ENABLE_ASYMMETRIC_AUTH_ENV}}', process.env.ENABLE_ASYMMETRIC_AUTH_ENV || 'false');
    config = safeReplace(config, '{{ENABLE_DETAILED_LOGGING}}', process.env.ENABLE_DETAILED_LOGGING || 'true');
    config = safeReplace(config, '{{PRIVATE_KEY_HEX}}', process.env.PRIVATE_KEY_HEX);

    // 写回文件
    console.log('💾 写入配置文件...');
    fs.writeFileSync('wrangler.toml', config);

    // 验证生成的配置文件
    console.log('🔍 验证生成的配置文件...');
    const lines = config.split('\n');
    let hasPlaceholders = false;
    lines.forEach((line, index) => {
        if (line.includes('{{') && line.includes('}}')) {
            console.log(`⚠️  第${index + 1}行仍包含占位符: ${line.trim()}`);
            hasPlaceholders = true;
        }
    });

    if (hasPlaceholders) {
        console.log('❌ 配置文件中仍有未替换的占位符');
        process.exit(1);
    }

    console.log('✅ wrangler.toml 占位符替换完成');
    console.log('🎯 准备开始 Worker 部署...\n');

} catch (error) {
    console.error('❌ 构建脚本执行失败:', error);
    process.exit(1);
}
