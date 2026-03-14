const { sql } = require('@vercel/postgres');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Settings
const SETTINGS = {
    fastMA: 23,
    slowMA: 50,
    cyclePeriod: 10,
    d1Length: 3,
    d2Length: 3,
    upperBand: 80,
    lowerBand: 20
};

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

const TIMEFRAMES = [
    { value: '1h', name: '1 Hour', interval: '1h' },
    { value: '4h', name: '4 Hours', interval: '4h' },
    { value: '1d', name: '1 Day', interval: '1d' }
];

// Simple EMA calculation
function calculateEMA(prices, period) {
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
}

// Calculate Schaff Cycle (simplified)
function calculateSchaffCycle(closePrices) {
    if (closePrices.length < 100) return 50;
    
    const fastEMA = calculateEMA(closePrices.slice(-50), SETTINGS.fastMA);
    const slowEMA = calculateEMA(closePrices.slice(-50), SETTINGS.slowMA);
    const macd = fastEMA - slowEMA;
    
    // Simplified Schaff calculation (0-100 scale)
    const highest = Math.max(...closePrices.slice(-20));
    const lowest = Math.min(...closePrices.slice(-20));
    
    if (highest === lowest) return 50;
    
    const schaff = ((macd - lowest) / (highest - lowest)) * 100;
    return Math.min(100, Math.max(0, schaff));
}

// Fetch Binance data
async function fetchPrice(symbol) {
    try {
        const response = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`);
        return response.data.map(k => parseFloat(k[4])); // Close prices
    } catch (error) {
        console.error(`Error fetching ${symbol}:`, error.message);
        return null;
    }
}

// Send alert
async function sendAlert(chatId, asset, timeframe, signal, value) {
    const emoji = signal.type === 'BUY' ? '🟢' : signal.type === 'SELL' ? '🔴' : '⚠️';
    
    const message = `
${emoji} *Schaff Cycle Alert* ${emoji}

${asset.emoji} *${asset.name}*
⏱️ ${timeframe.name}
📊 Value: ${value.toFixed(2)}
🎯 Signal: ${signal.type}
📝 ${signal.reason}

#SchaffCycle #${asset.base}
    `;
    
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
        return true;
    } catch (error) {
        if (error.response?.data?.error_code === 403) {
            // User blocked bot - deactivate
            await sql`UPDATE users SET is_active = false WHERE chat_id = ${chatId}`;
        }
        return false;
    }
}

// Check cooldown
async function checkCooldown(chatId, asset, signalType) {
    const result = await sql`
        SELECT sent_at FROM alert_history 
        WHERE chat_id = ${chatId} 
        AND asset_symbol = ${asset.symbol}
        AND signal_type = ${signalType}
        ORDER BY sent_at DESC LIMIT 1
    `;
    
    if (result.rows.length === 0) return true;
    
    const lastSent = new Date(result.rows[0].sent_at);
    const cooldown = 15 * 60 * 1000; // 15 minutes
    return (Date.now() - lastSent.getTime()) > cooldown;
}

// Main monitoring function
module.exports = async (req, res) => {
    console.log('Starting monitoring...', new Date().toISOString());

    try {
        // Get active users
        const users = await sql`SELECT * FROM users WHERE is_active = true`;
        
        if (users.rows.length === 0) {
            return res.status(200).json({ message: 'No active users' });
        }

        // Process each asset
        for (const asset of ASSETS) {
            const prices = await fetchPrice(asset.symbol);
            if (!prices) continue;
            
            const currentValue = calculateSchaffCycle(prices);
            
            // Check each timeframe (simplified - using same value for demo)
            for (const timeframe of TIMEFRAMES) {
                // Get previous value from DB
                const lastSignal = await sql`
                    SELECT schaff_value FROM last_signals 
                    WHERE asset_symbol = ${asset.symbol} 
                    AND timeframe = ${timeframe.value}
                `;
                
                const previousValue = lastSignal.rows[0]?.schaff_value || currentValue;
                
                // Check for signals
                const signals = [];
                
                if (previousValue <= SETTINGS.lowerBand && currentValue > SETTINGS.lowerBand) {
                    signals.push({ type: 'BUY', reason: 'Oversold bounce', strength: 'STRONG' });
                }
                if (previousValue >= SETTINGS.upperBand && currentValue < SETTINGS.upperBand) {
                    signals.push({ type: 'SELL', reason: 'Overbought rejection', strength: 'STRONG' });
                }
                if (currentValue > SETTINGS.upperBand && previousValue <= SETTINGS.upperBand) {
                    signals.push({ type: 'WARNING', reason: 'Entering overbought', strength: 'MODERATE' });
                }
                if (currentValue < SETTINGS.lowerBand && previousValue >= SETTINGS.lowerBand) {
                    signals.push({ type: 'WARNING', reason: 'Entering oversold', strength: 'MODERATE' });
                }
                
                // Save current value
                await sql`
                    INSERT INTO last_signals (asset_symbol, timeframe, schaff_value)
                    VALUES (${asset.symbol}, ${timeframe.value}, ${currentValue})
                    ON CONFLICT (asset_symbol, timeframe) 
                    DO UPDATE SET schaff_value = EXCLUDED.schaff_value
                `;
                
                // Send alerts if signals detected
                if (signals.length > 0) {
                    for (const user of users.rows) {
                        // Check if user subscribed to this asset
                        const subCheck = await sql`
                            SELECT * FROM asset_subscriptions 
                            WHERE chat_id = ${user.chat_id} 
                            AND asset_symbol = ${asset.symbol}
                        `;
                        
                        const isSubscribed = user.selected_asset === 'ALL' || subCheck.rows.length > 0;
                        
                        if (isSubscribed) {
                            for (const signal of signals) {
                                const cooldownOk = await checkCooldown(user.chat_id, asset, signal.type);
                                
                                if (cooldownOk) {
                                    const sent = await sendAlert(user.chat_id, asset, timeframe, signal, currentValue);
                                    
                                    if (sent) {
                                        await sql`
                                            INSERT INTO alert_history (chat_id, asset_symbol, timeframe, signal_type, schaff_value)
                                            VALUES (${user.chat_id}, ${asset.symbol}, ${timeframe.value}, ${signal.type}, ${currentValue})
                                        `;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        res.status(200).json({ 
            success: true, 
            usersProcessed: users.rows.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Monitor error:', error);
        res.status(500).json({ error: 'Monitoring failed' });
    }
};
