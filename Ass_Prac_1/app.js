const express = require('express');
const responseTime = require('response-time');
const axios = require('axios');
const redis = require('redis');
const AWS = require('aws-sdk');
require('dotenv').config();

const bucketName = 'alexraymond-wikipedia-store';
const app = express();


const redisClient =  redis.createClient();

redisClient.on('error', (err) => {
    console.log('error', err);
});

app.use(responseTime());

app.get('/api/search', (req, res) => {
    const query = (req.query.query).trim();

    const searchURL = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${ query}`;
    const redisKey = `wikipedia:${query}`; 
    //try cache
    return redisClient.get(redisKey, (err, result) => {
        if (result) {
            //serve from cache
            const resultJSON = JSON.parse(result);
            return res.status(200).json(resultJSON);
        }
        else {
            return axios.get(searchURL)
            .then(response => {
                const responseJSON = response.data;
                redisClient.setex(redisKey, 3600, JSON.stringify({source: 'Redis Cache', ...responseJSON, }));
                return res.status(200).json({ source: 'Wikipedia API', ...responseJSON, });
            })
            .catch(err => {
                return res.json(err);
            });
        }
    });
});

app.listen(3000, () => {
    console.log('server listening on port 3000');
})