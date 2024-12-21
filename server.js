const express = require('express');
const dotenv = require('dotenv');
const result = dotenv.config();
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const path = require('path');
const app = express();

if (result.error) {
    console.error('Error loading .env file:', result.error);
    process.exit(1);
}

// API Keys
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const MEDIASTACK_API_KEY = process.env.MEDIASTACK_API_KEY;
const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY;




const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Helper function to check for currency conversion request
function detectCurrencyQuery(message) {
    const currencyKeywords = ['convert', 'exchange rate', 'currency', 'usd', 'eur', 'gbp', 'ngn', 'dollar', 'euro', 'pound', 'naira'];
    return currencyKeywords.some(keyword => message.toLowerCase().includes(keyword));
}

// Function to extract currency information
async function getCurrencyInfo(message) {
    try {
        // Get latest exchange rates
        const response = await axios.get(`https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/latest/USD`);
        const rates = response.data.conversion_rates;
        const currentDate = new Date().toLocaleDateString();
        
        let contextualInfo = `As of ${currentDate}, the current exchange rates are:\n`;
        contextualInfo += `1 USD (United States Dollar) equals ${rates.NGN} NGN (Nigerian Naira).\n`;
        contextualInfo += `1 USD equals ${rates.EUR} EUR (Euro).\n`;
        contextualInfo += `1 USD equals ${rates.GBP} GBP (British Pound).\n`;
        contextualInfo += `These are the latest real-time exchange rates from a reliable forex data source.\n`;
        
        // Add specific instruction for the AI
        contextualInfo += `Please use these current rates to answer any currency conversion questions.`;
        
        return contextualInfo;
    } catch (error) {
        console.error("Currency API Error:", error);
        return "";
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/chat', async (req, res) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const { messages } = req.body;
        const userMessage = messages[0].content;

        let contextualInfo = "";

        // Check for currency-related query
        if (detectCurrencyQuery(userMessage)) {
            contextualInfo = await getCurrencyInfo(userMessage);
        } else {
            // Check if query might be about recent events
            const timeRelatedKeywords = ['recent', 'latest', 'news', 'today', '2024', '2023', 'current', 'price', 'stock', 'market'];
            const mightBeRecentQuery = timeRelatedKeywords.some(keyword => 
                userMessage.toLowerCase().includes(keyword)
            );

            // If it might be about recent events, fetch news
            if (mightBeRecentQuery) {
                try {
                    const mediaStackResponse = await axios.get('http://api.mediastack.com/v1/news', {
                        params: {
                            access_key: MEDIASTACK_API_KEY,
                            keywords: userMessage,
                            limit: 3,
                            sort: 'published_desc',
                            languages: 'en'
                        }
                    });

                    if (mediaStackResponse.data.data && mediaStackResponse.data.data.length > 0) {
                        const recentNews = mediaStackResponse.data.data.slice(0, 2);
                        contextualInfo = "Based on recent news: " + 
                            recentNews.map(article => 
                                `${article.title} (${new Date(article.published_at).toLocaleDateString()})`
                            ).join(". ") + ". ";
                    }
                } catch (error) {
                    console.error("MediaStack API Error:", error);
                }
            }
        }

        // Combine contextual info with user's question
        const enhancedPrompt = contextualInfo + 
            "Please answer this question: " + userMessage;

        // Generate response
        const result = await model.generateContent(enhancedPrompt);
        const response = await result.response;
        const text = response.text();

        res.json({
            content: [{
                text: text
            }],
            contextInfo: contextualInfo ? { 
                type: detectCurrencyQuery(userMessage) ? 'currency' : 'news',
                data: contextualInfo 
            } : null
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});