import "dotenv/config";
import { log } from "./log.js";
import express from "express";
import cookieParser from "cookie-parser";
import fs from "node:fs/promises";
import { fileURLToPath } from "url";
import path, { dirname } from "node:path";
import mime from "mime-types";
import compression from "compression";
import { account_db } from "./database.js";
import { createProxyMiddleware } from "http-proxy-middleware";
import httpProxy from "http-proxy";
import { generateAccount, verifyCookie, getUsers, getUserFromCookie, getRawData, retrieveData, createAccount, resetPassword, generateAccountPage, loginAccount, editProfile, addBadge, isAdmin, saveData } from "./account.js";
import { getGroqChatCompletion } from "./ai.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = process.env.PORT || 3000;
const app = express();
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
// add proxying to the mc server, so you can do selenite.cc/mc and connect
let proxy = httpProxy.createServer({ ws: true });
app.use("/mc", (req, res) => {
	proxy.web(req, res, {
		target: "wss://mc.selenite.cc",
	});
});
import WebSocket, { WebSocketServer } from "ws";
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", function connection(ws, req) {
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
		} else if (message.startsWith("token") && await verifyCookie(message.substring(6))) {
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
app.on("upgrade", function upgrade(request, socket, head) {
	const { pathname } = new URL(request.url, "wss://base.url");
	if (pathname === "/socket") {
		wss.handleUpgrade(request, socket, head, function done(ws) {
			wss.emit("connection", ws, request);
		});
	} else {
		socket.destroy();
	}
});

app.post(
	"/api/event",
	createProxyMiddleware({
		target: "http://plausible.selenite.cc",
		changeOrigin: true,
	})
);
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
app.post("/groq", async (req, res) => {
	res.send((await getGroqChatCompletion(req.body.msg)).choices[0]?.message?.content || "");
});
app.use(["/register", "/login"], async (req, res, next) => {
	console.log
	if (req.cookies.token && await verifyCookie(req.cookies.token)) {
		res.redirect("/u/");
	} else {
		res.type("text/html").status(200).send(await fs.readFile(`./html${req.baseUrl}.html`));
	}
});
app.use("/users", async (req, res, next) => {
	res.type("text/html").status(200).send(await fs.readFile(`./html/users.html`));
});
app.use("/reset", async (req, res, next) => {
	res.type("text/html").status(200).send(await fs.readFile(`./html/reset.html`));

});
app.post("/api/account/upload", async (req, res, next) => {
	if (req.cookies.token && await verifyCookie(req.cookies.token)) {
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
app.use("/api/generateAccount", async (req, res, next) => {
	generateAccount();
	res.send(200);
});
app.use("/api/account/load", async (req, res, next) => {
	if (req.cookies.token && await verifyCookie(req.cookies.token)) {
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
	if (await isAdmin(req.cookies.token) && await verifyCookie(req.cookies.token)) {
		res.type("text/html").status(200).send(await fs.readFile(`./html/admin.html`));
	} else {
		next();
	}
});
app.use('/', express.static('./selenite', {extensions: ["html"]}));
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
	if (req.cookies.token && await verifyCookie(req.cookies.token)) {
		res.send(await getRawData(req.cookies.token));
	} else {
		res.redirect("/login");
	}
});
app.use("/u/:username", async (req, res) => {
	res.send(await generateAccountPage(req.params.username, req.cookies.token));
});

app.use("/u/", async (req, res) => {
	if (req.cookies.token && await verifyCookie(req.cookies.token)) {
		res.send(await generateAccountPage(req.params.username, req.cookies.token));
	} else {
		res.redirect("/login");
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
	let status = await editProfile(req.body, req.cookies.token);
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
	res.type("text/html").send(await fs.readFile(`./selenite/404.html`)).status(404);
})