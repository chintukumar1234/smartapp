const express = require("express");
const webpush = require("web-push");
const { cert, initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

const {
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    FIREBASE_SERVICE_ACCOUNT_PATH,
    FIREBASE_DATABASE_URL,
} = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured in .env");
}

if (!FIREBASE_SERVICE_ACCOUNT_PATH || !FIREBASE_DATABASE_URL) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH and FIREBASE_DATABASE_URL must be configured in .env");
}

const serviceAccountPath =
    path.isAbsolute(FIREBASE_SERVICE_ACCOUNT_PATH)
        ? FIREBASE_SERVICE_ACCOUNT_PATH
        : path.resolve(__dirname, FIREBASE_SERVICE_ACCOUNT_PATH);

serviceAccount = require(serviceAccountPath);

initializeApp({
    credential: cert(serviceAccount),
    databaseURL: FIREBASE_DATABASE_URL,
});

const database = getDatabase();

webpush.setVapidDetails(
    "mailto:chintukr32101@gmail.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

function isValidSubscription(subscription) {
    return (
        subscription &&
        typeof subscription === "object" &&
        typeof subscription.endpoint === "string" &&
        subscription.endpoint.startsWith("https://") &&
        subscription.keys &&
        typeof subscription.keys === "object" &&
        typeof subscription.keys.p256dh === "string" &&
        typeof subscription.keys.auth === "string"
    );
}

app.post("/subscribe", async (req, res) => {

    const {
        ownerId,
        name,
        mobile,
        email,
        subscription
    } = req.body;


    // Check required data
    if (!ownerId || !name || !mobile || !email) {

        return res.status(400).json({
            message: "Owner information is required"
        });

    }


    // A push subscription is optional; account creation must work without it.
    if (subscription !== undefined && !isValidSubscription(subscription)) {

        return res.status(400).json({
            message: "Invalid subscription object"
        });

    }


    try {

        const ownerRef = database.ref(`owners/${ownerId}`);

        const snapshot = await ownerRef.once("value");

        const existingOwner = snapshot.val();


        // ==========================================
        // SAVE OWNER
        // ==========================================

        const ownerData = {
            name,
            mobile,
            email,
            updatedAt: new Date().toISOString()
        };

        if (subscription) {
            ownerData.notificationSubscription = subscription;
        }


        // Keep original creation time
        if (!existingOwner) {

            ownerData.createdAt = new Date().toISOString();

        }


        await ownerRef.update(ownerData);

        if (subscription) {
            await database.ref(`subscriptions/${ownerId}`).set(subscription);
        }

        return res.status(201).json({

            message: "Owner account saved successfully",

            ownerId: ownerId

        });

    }

    catch (error) {

        console.error(
            "Could not save owner:",
            error.message
        );

        const credentialsRejected =
            /invalid_grant|invalid.jwt.signature|invalid-credential/i.test(error.message);

        return res.status(500).json({

            message: credentialsRejected
                ? "Firebase rejected the server credentials. Check that the service-account key is active and matches the configured service account, and verify the server clock."
                : "Could not save subscription"

        });

    }

});


//for display data from owners database
app.get("/show_subscriptions", (req, res) => {
try{
    const ownersRef = database.ref("owners");
    ownersRef.once("value", (snapshot) => {
        const ownersData = snapshot.val();
        return res.json({ owners: ownersData, ownerId: ownersData ? Object.keys(ownersData)[0] : null });
    });
}catch (error) {
    console.error("Error retrieving owners data:", error.message);
}
});
// this is for count the sales products beacause i want the number of the each product
app.get("/product_name", (req, res) => {
try{
    const ownersRef = database.ref("submit");
    ownersRef.once("value", (snapshot) => {
        const productName = snapshot.val();
        return res.json({ productname: productName});
    });
}catch (error) {
    console.error("Error retrieving owners data:", error.message);
}
});
//this is for active customers
app.get("/active_data", (req, res) => {
try{
    const ownersRef = database.ref("submit");
    ownersRef.once("value", (snapshot) => {
        const ownersData = snapshot.val();
        return res.json({ activedata: ownersData, ownerId: ownersData ? Object.keys(ownersData)[0] : null });
    });
}catch (error) {
    console.error("Error retrieving active data:", error.message);
}
});

app.get("/all_products", (req, res) => {
try{
    const ownersRef = database.ref("user");
    ownersRef.once("value", (snapshot) => {
        const productName = snapshot.val();
        return res.json({ productname: productName});
    });
}catch (error) {
    console.error("Error retrieving owners data:", error.message);
}
});

app.post("/send_notification", async (req, res) => {
    const { title, message } = req.body || {};
    const finalTitle = typeof title === "string" ? title.trim() : "";
    const finalMessage = typeof message === "string" ? message.trim() : "";

    if (!finalTitle || !finalMessage) {
        return res.status(400).json({ message: "Notification title and message are required" });
    }

    const payload = JSON.stringify({
        title: finalTitle,
        message: finalMessage,
    });

    try {
        const [subscriptionsSnapshot, ownersSnapshot] = await Promise.all([
            database.ref("subscriptions").once("value"),
            database.ref("owners").once("value"),
        ]);
        const subscriptionsByEndpoint = new Map();

        const addSubscription = (subscription, refPath) => {
            if (!isValidSubscription(subscription)) {
                return;
            }
            const existing = subscriptionsByEndpoint.get(subscription.endpoint);
            if (existing) {
                existing.refPaths.push(refPath);
                return;
            }
            subscriptionsByEndpoint.set(subscription.endpoint, {
                subscription,
                refPaths: [refPath],
            });
        };

        subscriptionsSnapshot.forEach((child) => {
            const subscription = child.val();
            if (isValidSubscription(subscription)) {
                addSubscription(subscription, `subscriptions/${child.key}`);
            } else {
                child.ref.remove().catch(() => undefined);
            }
        });

        ownersSnapshot.forEach((child) => {
            const owner = child.val();
            addSubscription(
                owner && owner.notificationSubscription,
                `owners/${child.key}/notificationSubscription`
            );
        });

        const subscriptions = [...subscriptionsByEndpoint.values()];
        if (subscriptions.length === 0) {
            return res.status(409).json({
                message: subscriptionsSnapshot.exists() || ownersSnapshot.exists()
                    ? "No valid device subscriptions found"
                    : "No device is subscribed to notifications",
            });
        }

        let sentCount = 0;
        const failureStatusCodes = new Set();

        await Promise.all(
            subscriptions.map(async ({ subscription, refPaths }) => {
                try {
                    await webpush.sendNotification(subscription, payload);
                    sentCount += 1;
                } catch (error) {
                    const statusCode = Number.isInteger(error.statusCode)
                        ? error.statusCode
                        : null;
                    const pushService = subscription.endpoint.split("/")[2] || "unknown";

                    console.error("Notification delivery failed:", {
                        statusCode,
                        pushService,
                        message: error.message,
                        response: error.body,
                    });

                    if (statusCode !== null) {
                        failureStatusCodes.add(statusCode);
                    }
                    if ([401, 403, 404, 410].includes(statusCode)) {
                        await Promise.all(
                            refPaths.map((refPath) => database.ref(refPath).remove())
                        );
                    }
                }
            })
        );

        if (sentCount === 0) {
            const statusCodes = [...failureStatusCodes];
            const statusDetails = statusCodes.length
                ? ` Push service HTTP status: ${statusCodes.join(", ")}.`
                : "";
            const refreshInstructions = statusCodes.some((code) => [401, 403].includes(code))
                ? " The rejected device subscriptions were removed; re-enable notifications from the owner page."
                : "";
            return res.status(502).json({
                message: `Notification could not be delivered.${statusDetails}${refreshInstructions} Check server logs for details.`,
            });
        }

        return res.json({
            message: "Notification sent",
            sentCount,
        });
    } catch (error) {
        console.error("Could not send notification:", error.message);
        return res.status(500).json({ message: "Could not send notification" });
    }
});

app.listen(port, () => {
    console.log(`server is running on port http://localhost:${port}`);
});