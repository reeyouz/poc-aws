const fs = require("fs");
const app_root_path = require("app-root-path");
const path = require("path");
const express = require("express");
const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
    MultiPart
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const multer = require('multer');
const _knex = require('knex');

if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}

const Bucket = process.env.BUCKET;
const PORT = process.env.PORT || 3000;
const folder_name = "firmwares";
const VALID_EXTENSIONS = ["crc"];
const file_size_limit = 40 * 1024 * 1024; // in bytes
const file_name_limit = 250;
const storage = new StorageEngine();
const client = new S3Client({
    region: process.env.AWS_DEFAULT_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});
const upload = multer({
    storage,
    // storage: {
    //     _handleFile: (req, file, callback) => {
    //         file.filename
    //     },
    // },
    limits: {
        fileSize: file_size_limit,
    },
});
const knex = _knex({
    client: "pg",
    connection: process.env.DATABASE_URL,
});

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(request_logger);

app.get("/", health_check);
app.put("/refresh", refresh_handler);
app.post(
    "/support/firmware",
    upload.single("firmware"),
    post_firmware,
);

app.use(response_logger);
app.use(error_handler);


//   __   __       ___  __  __ 
//  |__| |  | |  |  |  |__ |__ 
//  |  \ |__| |__|  |  |__  __|
//

function health_check(req, res, next) {
    res.status = 200;
    res.json({ message: "ok", time: new Date() });
    next();
};

async function refresh_handler(req, res, next) {
    try {
        const { clean = false } = req.body;
        await refresh(clean);
        res.status = 200;
        next();
    } catch (error) {
        next(error);
    }
};

async function post_firmware(req, res, next) {
    try {
        const a = 2 + 2;
        // await add_firmware();
        res.status = 200;
        next()
    } catch (error) {
        next(error);
    }
}

//   __   __  __  _    _ ___  ___  __  __ 
//  |__  |__ |__|  \  /   |  |    |__ |__ 
//   __| |__ |  \   \/   _|_ |___ |__  __|
//

async function refresh(clean = false) {
    const folder_path = path.resolve(
        app_root_path.toString(),
        folder_name,
    );
    if (!path_exists(folder_path)) {
        create_folder(folder_path);
    } else {
        if (clean) {
            clear_folder(folder_path);
        }
    }
    const objects_in_bucket = await client.send(
        new ListObjectsV2Command({
            Bucket,
        }),
    );
    const { Contents } = objects_in_bucket;
    if (Array.isArray(Contents)) {
        for (let i = 0; i < Contents.length; i++) {
            const { Key } = Contents[i];
            if (Key !== undefined) {
                const file_path = path.resolve(folder_path, Key);
                if (path_exists(file_path) && !clean) {
                    continue;
                }
                const object =  await client.send(
                    new GetObjectCommand({
                        Bucket,
                        Key,
                    }),
                );
                const { Body } = object;
                if (Body !== undefined) {
                    const write_stream = fs.createWriteStream(
                        file_path,
                        { autoClose: true },
                    );
                    if (path_exists(file_path)) {
                        if (clean) {
                            Body.pipe(write_stream);
                        }
                    } else {
                        const [model] = Key.split("/");
                        const model_path = path.resolve(folder_path, model);
                        if (!path_exists(model_path)) {
                            create_folder(model_path);
                        }
                        Body.pipe(write_stream);
                    }
                }
            }
        }
    }
};

async function add_firmware() {

}

function StorageEngine() {

}

StorageEngine.prototype._handleFile = async function (req, file, callback) {
    try {
        await is_valid_body_schema(req, file, callback);
        const { model, version } = req.body;
        const extension = file.originalname.split(".")[1];
        const aws_upload = new Upload({
            client,
            params: {
                Bucket,
                Key: `${model}/${version}.${extension}`,
                Body: file.stream,
            },
            partSize: 5 * 1024 * 1024,
            queueSize: 1,
        });
        aws_upload.on("httpUploadProgress", async (progress) => {
            console.log(progress);
            if (progress.loaded > file_size_limit) {
                await aws_upload.abort();
                let error = new Error(`File size exceeds ${file_size_limit} bytes!`);
                error.status = 400;
                callback(error);
            }
        });
        await aws_upload.done();
        callback(null, true);
    } catch (error) {
        callback(error);
    }
}

StorageEngine.prototype._removeFile = function (req, file, callback) {
    let b = 2;
    callback(null);
};

async function is_valid_body_schema(req, file, callback) {

    const { model, version } = req.body;
    const { originalname } = file;
    
    //
    //  Property 'model' is required
    //
    if (model === null || model === undefined) {
        let error = new Error("Property 'model' is required!");
        error.status = 400;
        callback(error);
    }

    //
    //  Property 'version' is required
    //
    if (version === null || version === undefined) {
        let error = new Error("Property 'version' is required!");
        error.status = 400;
        callback(error);
    }

    //
    //  Property 'version' should follow semver.
    //
    if (!/^[1-9][0-9]*.[0-9]+.[0-9]+$/.test(version)) {
        let error = new Error("Property 'version' should follow semver!");
        error.status = 400;
        callback(error);
    }

    if (!/^\w+\.[a-zA-Z]{2,}$/.test(originalname)) {
        let error = new Error(`File name can only contain alphanumeric and underscore characters!`);
        error.status = 400;
        callback(error);
    }

    let [file_name, extension] = originalname.split(".");
    extension = extension.toLowerCase();

    //
    //  File name cannot be greater than file_name_limit characters!
    //
    if (file_name.length > file_name_limit) {
        let error = new Error(`File name can be upto ${file_name_limit} characters!`);
        error.status = 400;
        callback(error);
    }

    //
    //  Only specific extensions must be allowed
    //
    if (!VALID_EXTENSIONS.includes(extension)) {
        let error = new Error(`Permitted file types are ${VALID_EXTENSIONS.join(", ")}!`);
        error.status = 400;
        callback(error);
    }

    //
    //  'model' can only be one from the list
    //
    const unique_models = await get_unique_models();
    if (!unique_models.includes(model)) {
        let error = new Error(`Valid 'model' values are: ${unique_models.join(", ")}`);
        error.status = 400;
        callback(error);
    }

    //
    //  Same version and same model can't be there
    //
    const is_duplicate = await is_duplicate_version(model, version);
    if (is_duplicate) {
        let error = new Error(`Firmware with version ${version} already exists for model ${model}!`);
        error.status = 400;
        callback(error);
    }

}

async function is_duplicate_version(model, version) {
    return knex('firmware')
        .where({ model, version })
        .then((result) => result.length > 0);
}

async function get_unique_models() {
    let result = await knex('firmware')
        .select("model")
        .groupBy('model');
    return result.map(({ model }) => model);
}

//        __      __   __  __   __ 
//  |__| |__ |   |__| |__ |__| |__ 
//  |  | |__ |__ |    |__ |  \  __|
//

function request_logger(req, res, next) {
    console.log({
        http_version: req.httpVersion,
        method: req.method,
        url: req.url,
        path: req.path,
        ip: req.ip,
        host_name: req.hostname,
    });
    next();
};

function response_logger(req, res, next) {
    console.log({
        status: typeof res.status === "function" ? res.status() : res.status,
        body: res.body,
    });
    return res.end();
};

function error_handler(error, req, res, next) {
    console.log(error);
    return res
        .status(error.status || 500)
        .json({
            message: error.message,
            description: error.description || "",
            stack: error.stack,
        });
};

function create_folder(folder_path) {
    return fs.mkdirSync(folder_path, { recursive: true });
};

function remove_folder(folder_path) {
    return fs.rmSync(folder_path, { recursive: true });
};

function clear_folder(folder_path) {
    remove_folder(folder_path);
    create_folder(folder_path);
};

function path_exists(item_path) {
    return fs.existsSync(item_path);
};

async function sleep(ms = 1000) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

refresh(false)
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server listening on port ${PORT}`);
        });
    })
    .catch(async (err) => {
        console.error(err);
        await sleep(1000);
        refresh(true);
    });
