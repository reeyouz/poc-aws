const fs = require("fs");
const app_root_path = require("app-root-path");
const path = require("path");
const express = require("express");
const { config } = require("dotenv");
const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const db = require("./db.json");

config();

const Bucket = process.env.BUCKET;
const PORT = process.env.PORT || 3000;
const property_name = "version";
const folder_name = "firmwares";
const file_extension = ".txt";
const mock_db_file_name = "db.json";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    return res.status(200).json({ message: "ok", time: new Date() });
});

app.put("/", async (req, res, next) => {
    try {
        console.log("Started");

        const client = new S3Client({
            region: process.env.REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
        });
    
        const list_object_v2_response = await client.send(
            new ListObjectsV2Command({
                Bucket,
            }),
        );
    
        let cloud = {};
    
        if (Array.isArray(list_object_v2_response.Contents)) {
            for (let i = 0; i < list_object_v2_response.Contents.length; i++) {
                const { Key } = list_object_v2_response.Contents[i];
                if (Key !== undefined) {
                    const { Metadata } = await client.send(
                        new HeadObjectCommand({
                            Bucket,
                            Key,
                        }),
                    );
                    if (Metadata !== undefined) {
                        cloud[Key.replace(file_extension, "")] = {
                            version: Metadata[property_name],
                            Key, 
                        };
                    }
                }
            }
        }
    
        let db = await get_models_from_db();
    
        let changed = [];
    
        for (const Key in cloud) {
            if (is_version(cloud[Key].version, db[Key])) {
                if (cloud[Key].version !== db[Key]) {
                    changed.push({
                        model: Key,
                        Key: cloud[Key].Key,
                        db: db[Key],
                        s3: cloud[Key].version,
                    });
                }
            }
        }
    
        console.log({ changed, db, cloud });
    
        for (let i = 0; i < changed.length; i++) {
            const { s3, model, Key } = changed[i];
            const get_object_response = await client.send(
                new GetObjectCommand({
                    Bucket,
                    Key,
                }),
            );
            const file_path = path.resolve(
                app_root_path.toString(),
                folder_name,
                Key,
            );
            const write_stream = fs.createWriteStream(
                file_path,
                { autoClose: true },
            );
            get_object_response.Body.pipe(write_stream);
            await update_model(model, s3);
        }

        return res.status(200).send();
    } catch (error) {
        next(error);
    }
});

app.use((error, req, res, next) => {
    return res.status(500).json({
        message: error.message,
        stack: error.stack,
    });
})

async function get_models_from_db() {
    let map = {};
    for (let i = 0; i < db.length; i++) {
        const { model, version } = db[i];
        map[model] = version;
    };
    return map;
}

async function update_model(model, version) {
    let updated_db = [...db];
    for (let i = 0; i < updated_db.length; i++) {
        if (updated_db[i].model === model) {
            updated_db[i].version = version;
            break;
        }
    }
    const db_path = path.resolve(app_root_path.toString(), mock_db_file_name);
    const write_stream = fs.createWriteStream(db_path, { autoClose: true });
    write_stream.write(
        JSON.stringify(updated_db, undefined, 2),
        (error) => {
            if (error) {
                console.error(error);
            }
        },
    );
}

function is_version(...str_arr) {
    for (let i = 0; i < str_arr.length; i++) {
        const parts = str_arr[i].split(".");
        if (parts.length !== 3) {
            return false;
        }
        for (let i = 0; i < 3; i++) {
            if (!/^[\d]+$/.test(parts[i])) {
                return false;
            }
        }
    }
    return true;
}

app.listen(PORT, () => {
    console.log(`Server is running at Port ${PORT}`);
});
