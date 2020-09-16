const express = require("express");
const responseTime = require("response-time");
const axios = require("axios");
const redis = require("redis");
const AWS = require("aws-sdk");
require("dotenv").config();

const bucketName = "n10176705-wikipedia-store";
const app = express();

//Create redis connection
const redisClient = redis.createClient();

redisClient.on("error", (err) => {
  console.log("error", err);
});

//Create AWS S3 connection
const bucketPromise = new AWS.S3({ apiVersion: "2006-03-01" })
  .createBucket({ Bucket: bucketName })
  .promise();
bucketPromise
  .then(function (data) {
    console.log("Successfully created " + bucketName);
  })
  .catch(function (err) {
    console.error(err, err.stack);
  });

app.use(responseTime());

app.get("/api/search", (req, res) => {
  console.log("into Search");
  const query = req.query.query.trim();
  const apiVersion = "2006-03-01";

  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${query}`;

  //Made little sense to have separate keys? Unnecessary complexity?
  const dbKey = `wikipedia:${query}`;

  //try cache
  return redisClient.get(dbKey, (err, result) => {
    if (result) {
      //serve from cache
      const resultJSON = JSON.parse(result);
      return res.status(200).json(resultJSON);
    } else {
      console.log("Didnt find in cache");

      // Check S3
      const params = { Bucket: bucketName, Key: dbKey };
      return new AWS.S3({ apiVersion: apiVersion }).getObject(
        params,
        (err, result) => {
          //If S3 exists, return it
          if (result) {
            const resultJSON = JSON.parse(result.Body);
            const responseJSON = resultJSON.parse;

            //Add to cache
            addToRedis(dbKey, responseJSON);

            //Return S3 result
            return res.status(200).json(resultJSON);
          } else {
            //No S3 Entry, search wikipedia
            console.log("No S3 Entry");
            return axios
              .get(searchUrl)
              .then((response) => {
                console.log("Response from Wikipedia");
                const responseJSON = response.data;

                //Add to Cache
                addToRedis(dbKey, responseJSON);

                //Add to S3
                const body = JSON.stringify({
                  source: "S3 Bucket",
                  ...responseJSON,
                });
                const objectParams = {
                  Bucket: bucketName,
                  Key: dbKey,
                  Body: body,
                };
                const uploadPromise = new AWS.S3({ apiVersion: apiVersion })
                  .putObject(objectParams)
                  .promise();
                uploadPromise.then(function (data) {
                  console.log("Successful upload to ", bucketName, "/", dbKey);
                });

                //Return wikipedia entry
                return res
                  .status(200)
                  .json({ source: "Wikipedia API", ...responseJSON });
              })
              .catch((err) => {
                return res.json(err);
              });
          }
        }
      );
    }
  });
});

function addToRedis(dbKey, responseJSON) {
  redisClient.setex(
    dbKey,
    3600,
    JSON.stringify({ source: "Redis Cache", ...responseJSON })
  );
  console.log("Successful upload to Cache:", dbKey);
}

app.get("/api/store", (req, res) => {
  console.log("Into api/store");
  const key = req.query.key.trim();
  const apiVersion = "2006-03-01";

  //construct wiki URL and S3 key
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`;
  const dbKey = `wikipedia-${key}`;

  // Check S3
  const params = { Bucket: bucketName, Key: dbKey };

  return new AWS.S3({ apiVersion: "2006-03-01" }).getObject(
    params,
    (err, result) => {
      console.log("Created Connection");
      if (result) {
        //Serve from S3
        const resultJSON = JSON.parse(result.Body);
        return res.status(200).json(resultJSON);
      } else {
        return axios
          .get(searchUrl)
          .then((response) => {
            const responseJSON = response.data;
            const body = JSON.stringify({
              source: "S3 Bucket",
              ...responseJSON,
            });
            const objectParams = { Bucket: bucketName, Key: dbKey, Body: body };
            const uploadPromise = new AWS.S3({ apiVersion: apiVersion })
              .putObject(objectParams)
              .promise();
            uploadPromise.then(function (data) {
              console.log("Successful upload to ", bucketName, "/", dbKey);
            });
            return res
              .status(200)
              .json({ source: "Wikipedia API", ...responseJSON });
          })
          .catch((err) => {
            return res.json(err);
          });
      }
    }
  );
});

app.listen(3000, () => {
  console.log("server listening on port 3000");
});
