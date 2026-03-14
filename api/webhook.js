const { sql } = require('@vercel/postgres');
const { createClient } = require('@vercel/kv');
const axios = require('axios');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Assets list
const ASSETS = [
    { symbol: 'BTCUSDT', name: 'Bitcoin', emoji: '₿', base: 'BTC' },
    { symbol: 'ETHUSDT', name: 'Ethereum', emoji: '⟠', base: 'ETH' },
    { symbol: 'PAXGUSDT', name: 'PAXG/Gold', emoji: '🥇', base: 'PAXG' },
    { symbol: 'XAGUSDT', name: 'Silver', emoji: '🥈', base: 'XAG' },
    { symbol: 'EURUSDT', name: 'Euro', emoji: '💶', base: 'EUR' },
    { symbol: 'JPYUSDT', name: 'Yen', emoji: '💴', base: 'JPY' },
    { symbol: 'GBPUSDT', name: 'Pound', emoji: '💷', base: 'GBP' },
    { symbol: 'CADUSDT', name: 'Canadian Dollar', emoji: '💵', base: 'CAD' }
];

// Initialize KV
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// Helper: Send Telegram message
async function sendTelegramMessage(chatId, text) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Telegram error:', error.response?.data || error.message);
    }
}

// Helper: Send typing action
async function sendTypingAction(chatId) {
    try {
        await axios.post(`${TELEGRAM_API}/sendChatAction`, {
            chat_id: chatId,
            action: 'typing'
        });
    } catch (error) {
        console.error('Action error:', error);
    }
}

// Database functions
async function createOrUpdateUser(chatId, userData) {
    await sql`
        INSERT INTO users (chat_id, username, first_name, last_name, is_active)
        VALUES (${chatId}, ${userData.username}, ${userData.first_name}, ${userData.last_name}, true)
        ON CONFLICT (chat_id) 
        DO UPDATE SET 
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            is_active = true
    `;
    await kv.del(`user:${chatId}`);
}

async function getUser(chatId) {
    const cached = await kv.get(`user:${chatId}`);
    if (cached) return cached;

    const result = await sql`SELECT * FROM users WHERE chat_id = ${chatId}`;
    if (result.rows[0]) {
        await kv.set(`user:${chatId}`, result.rows[0]);
    }
    return result.rows[0];
}

async function subscribeToAll(chatId) {
    await sql`
        DELETE FROM asset_subscriptions WHERE chat_id = ${chatId}
    `;
    await sql`
        UPDATE users SET selected_asset = 'ALL' WHERE chat_id = ${chatId}
    `;
    await kv.del(`user:${chatId}`);
    await kv.del(`subs:${chatId}`);
}

async function subscribeToAsset(chatId, assetSymbol) {
    await sql`
        DELETE FROM asset_subscriptions WHERE chat_id = ${chatId}
    `;
    await sql`
        INSERT INTO asset_subscriptions (chat_id, asset_symbol)
        VALUES (${chatId}, ${assetSymbol})
    `;
    await sql`
        UPDATE users SET selected_asset = ${assetSymbol} WHERE chat_id = ${chatId}
    `;
    await kv.del(`user:${chatId}`);
    await kv.del(`subs:${chatId}`);
}

async function deactivateUser(chatId) {
    await sql`
        UPDATE users SET is_active = false WHERE chat_id = ${chatId}
    `;
    await kv.del(`user:${chatId}`);
}

// Command handlers
const commands = {
    '/start': async (chatId, msg) => {
        await createOrUpdateUser(chatId, {
            username: msg.from.username,
            first_name: msg.from.first_name,
            last_name: msg.from.last_name
        });
        await subscribeToAll(chatId);
        
        const welcome = `
🎯 *Welcome to Schaff Alerts Bot!* 🎯

I monitor assets using Schaff Cycle and send alerts.

📊 *Assets:*
${ASSETS.map(a => `${a.emoji} ${a.name} (/${a.base})`).join('\n')}

*Commands:*
/start - Start bot
/stop - Stop alerts
/all - ALL assets
/BTC - Bitcoin only
/ETH - Ethereum only
/PAXG - Gold only
/status - Your status
/help - Help

You're subscribed to ALL assets!
        `;
        await sendTelegramMessage(chatId, welcome);
    },

    '/stop': async (chatId) => {
        await deactivateUser(chatId);
        await sendTelegramMessage(chatId, '⏸️ Alerts stopped. Use /start to resume.');
    },

    '/all': async (chatId) => {
        await subscribeToAll(chatId);
        await sendTelegramMessage(chatId, '✅ Subscribed to ALL assets!');
    },

    '/status': async (chatId) => {
        const user = await getUser(chatId);
        const subs = await sql`
            SELECT asset_symbol FROM asset_subscriptions WHERE chat_id = ${chatId}
        `;
        
        let status = `📊 *Your Status*\n\n`;
        status += `Active: ${user?.is_active ? '✅' : '❌'}\n`;
        
        if (user?.selected_asset === 'ALL') {
            status += `Subscription: 🌐 All Assets\n\nMonitored:\n`;
            status += ASSETS.map(a => `${a.emoji} ${a.name}`).join('\n');
        } else if (subs.rows.length > 0) {
            const asset = ASSETS.find(a => a.symbol === subs.rows[0].asset_symbol);
            status += `Subscription: 🎯 ${asset?.emoji} ${asset?.name}`;
        }
        
        await sendTelegramMessage(chatId, status);
    },

    '/help': async (chatId) => {
        const help = `
🤖 *Schaff Alerts Bot Help*

*Commands:*
/start - Start bot
/stop - Stop alerts
/all - All assets
/BTC - Bitcoin only
/ETH - Ethereum only
/PAXG - Gold only
/XAG - Silver only
/EUR - Euro only
/JPY - Yen only
/GBP - Pound only
/CAD - CAD only
/status - Your status
/help - This message

*Alert Types:*
🟢 BUY - Cross above 20
🔴 SELL - Cross below 80
⚠️ WARNING - Extreme zone
        `;
        await sendTelegramMessage(chatId, help);
    }
};

// Add asset commands
ASSETS.forEach(asset => {
    commands[`/${asset.base}`] = async (chatId) => {
        await subscribeToAsset(chatId, asset.symbol);
        await sendTelegramMessage(chatId, `✅ Subscribed to ${asset.emoji} ${asset.name}!`);
    };
});

// Webhook handler
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message } = req.body;
        
        if (!message || !message.text) {
            return res.status(200).json({ ok: true });
        }

        const chatId = message.chat.id;
        const text = message.text.trim();
        
        if (text.startsWith('/')) {
            const command = text.split(' ')[0].toLowerCase();
            const handler = commands[command];
            
            if (handler) {
                await sendTypingAction(chatId);
                await handler(chatId, message);
            } else {
                await sendTelegramMessage(chatId, '❌ Unknown command. Try /help');
            }
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
