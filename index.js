import "dotenv/config";
import { log } from "./log.js";
import express from "express";
import cookieParser from "cookie-parser";
import fs from "node:fs/promises";
import { fileURLToPath } from "url";
import path, { dirname } from "node:path";
import mime from "mime-types";
import compression from "compression";
import { account_db, infiniteCache } from "./database.js";
import { createProxyMiddleware } from "http-proxy-middleware";
import { banUser, removeAccount, verifyCookie, getUsers, getUserFromCookie, getRawData, retrieveData, createAccount, resetPassword, generateAccountPage, loginAccount, editProfile, addBadge, isAdmin, saveData } from "./account.js";
import { infiniteCraft, chatBot } from "./ai.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = process.env.PORT || 3000;

const app = express();
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

import WebSocket, { WebSocketServer } from "ws";
import { verify } from "node:crypto";
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", function connection(ws, req, res) {
	setInterval(() => {
		ws.send("ping");
	}, 30000);

	ws.on("error", console.error);

	ws.on("message", async function message(data, isBinary) {
		let message = Buffer.from(data).toString();
		if (message.startsWith(process.env.ANNOUNCEMENT_KEY)) {
			wss.clients.forEach(function each(client) {
				if (client.readyState === WebSocket.OPEN) {
					client.send(message.replace(process.env.ANNOUNCEMENT_KEY, "announce."));
				}
			});
		} else if (message.startsWith("token") && (await verifyCookie(message.substring(6)))) {
			ws.id = await getUserFromCookie(message.substring(6));
			ws.send(ws.id);
			await account_db.update({ last_login: new Date().toUTCString() }, { where: { username: ws.id } });
		} else if (message.startsWith("pong")) {
			if (ws.id) {
				await account_db.update({ last_login: new Date().toUTCString() }, { where: { username: ws.id } });
				if (message.substring(4)) {
					const existingAccounts = await account_db.findOne({ where: { username: ws.id } });
					if (existingAccounts == null) {
						return { success: false, reason: "The account doesn't exist." };
					}
					let games;
					if (existingAccounts.playedgames) {
						games = JSON.parse(existingAccounts.playedgames);
					} else {
						games = {};
					}
					if (games[message.substring(4)]) {
						games[message.substring(4)] += 30;
					} else {
						games[message.substring(4)] = 30;
					}
					await account_db.update({ playedgames: JSON.stringify(games) }, { where: { username: ws.id } });
				}
			}
		}
	});

	ws.on("close", () => {});
});
app.post(
	"/api/event",
	createProxyMiddleware({
		target: "http://plausible.selenite.cc",
		changeOrigin: true,
	})
);
// app.use("*.json", async (req, res, next) => {
//	optimize json
// 	console.log("got data");
// 	next()
// });
app.post("/register", async (req, res) => {
	let status = await createAccount(req.body.username, req.body.password, req.body["h-captcha-response"]);
	if (status["success"]) {
		res.status(200).send(status);
	} else {
		res.status(400).send(status);
	}
});

app.post("/login", async (req, res) => {
	let status = await loginAccount(req.body.username, req.body.password, req.body["h-captcha-response"]);
	if (status["success"]) {
		res.status(200).send(status);
	} else {
		res.status(400).send(status);
	}
});
app.use(["/register", "/login"], async (req, res, next) => {
	if (req.cookies.token && (await verifyCookie(req.cookies.token))) {
		res.redirect("/u/");
	} else {
		res
			.type("text/html")
			.status(200)
			.send(await fs.readFile(`./html${req.baseUrl}.html`));
	}
});
app.use("/users", async (req, res, next) => {
	res
		.type("text/html")
		.status(200)
		.send(await fs.readFile(`./html/users.html`));
});
app.use("/reset", async (req, res, next) => {
	res
		.type("text/html")
		.status(200)
		.send(await fs.readFile(`./html/reset.html`));
});
app.post("/api/account/upload", async (req, res, next) => {
	if (req.cookies.token && (await verifyCookie(req.cookies.token))) {
		let status = await saveData(req.cookies.token, req.body.data);
		if (status["success"]) {
			res.status(200).send(status);
		} else {
			res.status(400).send(status);
		}
	} else {
		return "KILL YOURSELF";
	}
});
app.post("/api/ai/chat", async (req, res) => {
	if (await verifyCookie(req.cookies.token)) {
		if (req.body.messages) {
			res.send(await chatBot("", req.body.messages, await getUserFromCookie(req.cookies.token)));
		}
	}
});
app.get("/api/infinite/get", async (req, res, next) => {
	if (req.query[1] && req.query[2]) {
		let success = false;
		let data;
		let search1 = await infiniteCache.findOne({ where: { 1: req.query[1], 2: req.query[2] } });
		if (search1 !== null) {
			data = { item: search1.result_item, emoji: search1.result_emoji, new: false };
			success = true;
		}
		let search2 = await infiniteCache.findOne({ where: { 1: req.query[2], 2: req.query[1] } });
		if (search2 !== null) {
			data = { item: search2.result_item, emoji: search2.result_emoji, new: false };
			success = true;
		}
		if (success) {
			res.send(data);
			return;
		}
		data = await infiniteCraft(req.query[1], req.query[2]);
		try {
			let parse = JSON.parse(data);
			let keys = Object.keys(parse);
			if (keys.indexOf("item") > -1 && keys.indexOf("emoji") > -1) {
				parse.new = true;
				data = parse;
				infiniteCache.create({ 1: req.query[1], 2: req.query[2], result_item: data.item, result_emoji: data.emoji });
			}
		} catch {
			data = { item: "N/A", emoji: "N/A" };
		}
	}
});
app.use("/api/account/load", async (req, res, next) => {
	if (req.cookies.token && (await verifyCookie(req.cookies.token))) {
		let status = await retrieveData(req.cookies.token);
		if (status["success"]) {
			res.status(200).send(status);
		} else {
			res.status(400).send(status);
		}
	} else {
		res.status(200).send("No token");
	}
});

app.use("/api/getUsers", async (req, res, next) => {
	let status = await getUsers(req.query.page, req.query.query);
	res.status(200).send(status);
});

app.use("/admin", async (req, res, next) => {
	if ((await isAdmin(req.cookies.token)) && (await verifyCookie(req.cookies.token))) {
		res
			.type("text/html")
			.status(200)
			.send(await fs.readFile(`./html/admin.html`));
	} else {
		next();
	}
});
app.use("/ai", async (req, res, next) => {
	if (await verifyCookie(req.cookies.token)) {
		res
			.type("text/html")
			.status(200)
			.send(await fs.readFile(`./html/ai.html`));
	} else {
		next();
	}
});
app.use("/", express.static("./selenite", { extensions: ["html"] }));
app.use("/data/:id/:file", async (req, res) => {
	const id = path.basename(req.params.id);
	const file = path.basename(req.params.file);

	const filePath = path.join(process.env.DATA_PATH, "data", id, file);
	try {
		await fs.access(filePath);

		const image = await fs.readFile(filePath);
		if (mime.lookup(filePath) == "image/webp") {
			res.type("image/webp");
			res.status(200).send(image);
		} else {
			res.status(404).send("File not found");
		}
	} catch (error) {
		console.error(error);
		res.status(404).send("File not found");
	}
});

app.use("/u/raw", async (req, res) => {
	if (req.cookies.token && (await verifyCookie(req.cookies.token))) {
		res.send(await getRawData(req.cookies.token));
	} else {
		res.redirect("/register");
	}
});
app.use("/u/:username/edit", async (req, res, next) => {
	if (await isAdmin(req.cookies.token)) {
		res.send(await generateAccountPage(req.params.username, req.cookies.token, true));
		return;
	}
	next();
});
app.use("/u/:username", async (req, res) => {
	if (["skysthelimit.dev", "selenite.cc", "selenite", "owner"].includes(req.params.username)) {
		res.redirect("/u/sky");
		return;
	}
	res.send(await generateAccountPage(req.params.username, req.cookies.token));
});

app.use("/u/", async (req, res) => {
	if (req.cookies.token && (await verifyCookie(req.cookies.token))) {
		res.send(await generateAccountPage(req.params.username, req.cookies.token));
	} else {
		res.redirect("/register");
	}
});

app.post("/api/account/reset", async (req, res) => {
	let status = await resetPassword(req.body.username, req.body.key, req.body.password, req.body["h-captcha-response"]);
	if (status["success"]) {
		res.status(200).send(status);
	} else {
		res.status(400).send(status);
	}
});

app.post("/api/profile/edit", async (req, res) => {
	let status = await editProfile(req.body, req.cookies.token, false);
	if (status["success"]) {
		res.status(200).send(status);
	} else {
		res.status(400).send(status);
	}
});

app.post("/api/admin/badge", async (req, res) => {
	let status = await addBadge(req.body.username, req.body.badge, req.cookies.token);
	if (status["success"]) {
		res.status(200).send(status);
	} else {
		res.status(400).send(status);
	}
});
app.post("/api/admin/removeAcc", async (req, res) => {
	let status = await removeAccount(req.body.username, req.cookies.token);
	res.status(200).send(status);
});
app.post("/api/admin/removeAcc", async (req, res) => {
	let status = await editProfile(req.body, req.cookies.token, true);
	res.status(200).send(status);
});
app.post("/api/admin/ban", async (req, res) => {
	let status = await banUser(req.body.name, req.body.reason, req.cookies.token);
	res.status(200).send(status);
});
const server = app.listen(port, () => {
	console.log(log.success("Express is online."));
	console.log("- " + log.info("http://localhost:" + port));
});
server.on("upgrade", (request, socket, head) => {
	wss.handleUpgrade(request, socket, head, (socket) => {
		wss.emit("connection", socket, request);
	});
});

app.use(async (req, res) => {
	res
		.type("text/html")
		.send(await fs.readFile(`./selenite/404.html`))
		.status(404);
});
