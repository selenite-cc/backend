import crypto from "node:crypto";
import { accs } from "./database.js";
import { rword } from "rword";
import fs from "bun:fs";
import axios from "axios";
import sharp from "sharp";
import { fileURLToPath } from "url";
import path, { dirname } from "path";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";

dayjs.extend(relativeTime);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import sanitizeHtml from "sanitize-html";
const sanitizeConfig = {
	allowedTags: ["b", "i", "em", "strong", "a"],
	allowedAttributes: {
		a: ["href"],
	},
	disallowedTagsMode: "escape",
};
const sanitizeConfigNoLink = {
	allowedTags: ["b", "i", "em", "strong"],
	disallowedTagsMode: "escape",
};
const allowNone = {
	allowedTags: [],
	allowedAttributes: {},
	disallowedTagsMode: "discard",
};

let badge = {
	dev: "An official Selenite developer.",
	donate: "A Selenite donator.",
	mod: "An official Selenite moderator.",
	owner: "The owner of Selenite (/u/sky)",
};

let rawProfileHTML = fs.readFileSync("./html/profile.html").toString();
let rawEditProfileHTML = fs.readFileSync("./html/profile_edit.html").toString();
let profile404 = fs.readFileSync("./html/profile_404.html").toString();
let profileBan = fs.readFileSync("./html/profile_ban.html").toString();
let gamesJSON = JSON.parse(fs.readFileSync("./selenite/data/games.json").toString());
let appsJSON = JSON.parse(fs.readFileSync("./selenite/data/apps.json").toString());
let profileReadyJSON = {};
for (let i = 0; i < gamesJSON.length; i++) {
	profileReadyJSON[gamesJSON[i].directory] = { name: gamesJSON[i].name, image: gamesJSON[i].image };
}
for (let i = 0; i < appsJSON.length; i++) {
	profileReadyJSON[appsJSON[i].directory] = { name: appsJSON[i].name, image: appsJSON[i].image };
}

let gamesExceptions = { win11: "11", gba: "gba", turbowarp: "turbowarp", scratch1: "scratch1", emulatorjs: "emu" };

async function createAccount(name, pass, captcha) {
	try {
		if (!(name.length < 17 && name.length > 2 && !/[^a-zA-Z0-9._-]/.test(name))) {
			return { success: false, reason: "Bad username." };
		}
		if (!captcha) {
			return { success: false, reason: "No captcha response." };
		}
		if (!/^((?=\S*?[A-Z])(?=\S*?[a-z])(?=\S*?[0-9]).{5,})\S$/.test(pass)) {
			return { success: false, reason: "Bad password." };
		}
		const response = await axios.post("https://api.hcaptcha.com/siteverify", `response=${captcha}&secret=${process.env.HCAPTCHA_SECRET}`);
		const data = response.data;

		if (!data.success) {
			return { success: false, reason: "Captcha failed." };
		}

		const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)	
		let userData = existingAccount.get({ $1: name });
		if (userData !== null) {
			return { success: false, reason: "The account already exists." };
		}

		const id = `${Date.now()}${Math.round(Math.random() * 1000000)
			.toString()
			.padStart(6, 0)}`;
		const salt = crypto.randomBytes(128).toString("base64");
		const salted_pass = pass + salt;
		const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");
		const hash_pass = JSON.stringify({ pass: new_pass, salt: salt });
		let secret_key = rword.generate(6, { length: "3-7" }).join(" ").toUpperCase();
		const createAccount = accs.query(`INSERT INTO accounts (id, username, name, hashed_pass, secret_key, createdAt, updatedAt) VALUES ($id, $username, $name, $hashed_pass, $secret_key, $date, $date)`)
		createAccount.get({ $id: Number(id), $username: name.toLowerCase(), $name: name, $hashed_pass: hash_pass, $secret_key: secret_key, $date: new Date().toISOString().replace(/T/, ' ').replace(/\..+/g, '') });
		const updateAccount = accs.query(`UPDATE accounts SET last_login = $login WHERE username = $user`)
		updateAccount.get({ $login: new Date().toUTCString(), $user: name.toLowerCase() });

		return { success: true, key: secret_key };
	} catch (e) {
		shitHitTheFan("Account failed to create, probably something bad happened");
		shitHitTheFan("User info: " + name + ", " + pass);
		console.error("Error:", e);
		return { success: false, reason: e.message };
	}
}

async function resetPassword(name, key, pass, captcha) {
	const response = await axios.post("https://api.hcaptcha.com/siteverify", `response=${captcha}&secret=${process.env.HCAPTCHA_SECRET}`);

	const data = response.data;

	if (!data.success) {
		return { success: false, reason: "Captcha failed." };
	}
	key = key.toUpperCase();
	const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		
	let userData = existingAccount.get({ $1: name });
	if (userData == null) {
		return { success: false, reason: "The account does not exist." };
	}

	if (userData.secret_key == key) {
		const salt = crypto.randomBytes(128).toString("base64");
		const salted_pass = pass + salt;
		const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");
		const hash_pass = JSON.stringify({ pass: new_pass, salt: salt });
		const updateAccount = accs.query(`UPDATE accounts SET hashed_pass = $pass WHERE username = $user`)
		updateAccount.get({ $pass: hash_pass, $user: name.toLowerCase() });
		return { success: true };
	} else {
		return { success: false, reason: "Wrong key" };
	}
}

function buildGameHTML(existingAccount) {
	if (existingAccount.playedgames) {
		let games = JSON.parse(existingAccount.playedgames);
		let sortedGames = Object.keys(games).sort((a, b) => games[b] - games[a]);
		let return_data = [];
		if (Object.keys(games).length < 10) {
			for (let i = 0; i < sortedGames.length; i++) {
				try {
					let origin = gamesExceptions[sortedGames[i]] ? "sppa" : "semag";
					sortedGames[i] = gamesExceptions[sortedGames[i]] ? gamesExceptions[sortedGames[i]] : sortedGames[i];
					return_data[i] = { name: profileReadyJSON[sortedGames[i]].name, image: profileReadyJSON[sortedGames[i]].image, path: sortedGames[i], origin: origin, valid: true };
				} catch (e) {
					return_data[i] = { valid: false };
				}
			}
		} else {
			for (let i = 0; i < 10; i++) {
				try {
					let origin = gamesExceptions[sortedGames[i]] ? "sppa" : "semag";
					sortedGames[i] = gamesExceptions[sortedGames[i]] ? gamesExceptions[sortedGames[i]] : sortedGames[i];
					return_data[i] = { name: profileReadyJSON[sortedGames[i]].name, image: profileReadyJSON[sortedGames[i]].image, path: sortedGames[i], origin: origin, valid: true };
				} catch (e) {
					return_data[i] = { valid: false };
				}
			}
		}
		let return_html = "";
		for (let i = 0; i < Object.keys(return_data).length; i++) {
			if (return_data[i].valid) {
				return_html += `<div class="played-game"><img src="/${return_data[i].origin}/${return_data[i].path}/${return_data[i].image}"/><p>${return_data[i].name}</p></div>`;
			}
		}
		return return_html;
	} else {
		return "<h3>Play some games to view things appear here!</h3>";
	}
}

async function generateAccountPage(name, cookie, admin) {
	let userIsAdmin = false;
	if(admin) {
		userIsAdmin = await isAdmin(cookie);
	}
	if (name && !admin) {
		const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		
		let userData = existingAccount.get({ $1: name });
		if (userData == null || (await isBanned(name.toLowerCase()))) {
			return profile404;
		}

		let modifiedHTML = rawProfileHTML;
		modifiedHTML = modifiedHTML.replaceAll("{{ name }}", sanitizeHtml(userData.name, allowNone));
		modifiedHTML = modifiedHTML.replaceAll("{{ join_date }}", dayjs(userData.createdAt).fromNow());
		modifiedHTML = modifiedHTML.replaceAll("{{ about }}", sanitizeHtml(userData.about, sanitizeConfig) || "No about me available..");
		modifiedHTML = modifiedHTML.replaceAll("{{ about_none }}", sanitizeHtml(userData.about, allowNone) || "");
		modifiedHTML = modifiedHTML.replaceAll("{{ user_pfp }}", userData.pfp_url || "/img/user.svg");
		modifiedHTML = modifiedHTML.replaceAll("{{ custom_css }}", userData.custom_css || "");
		modifiedHTML = modifiedHTML.replaceAll("{{ online_time }}", dayjs(userData.last_login).fromNow());
		modifiedHTML = modifiedHTML.replaceAll("{{ played_games }}", buildGameHTML(userData));
		let badges_html = "";

		if (userData.badges !== null) {
			let badges = JSON.parse(userData.badges);
			for (let i = 0; i < badges.length; i++) {
				badges_html += `<img src="/img/badges/${badges[i]}.svg" class="badges" alt="${badge[badges[i]]}" title="${badge[badges[i]]}">`;
			}
		}
		modifiedHTML = modifiedHTML.replaceAll("{{ badges }}", badges_html);
		return modifiedHTML;
	} else if (cookie || userIsAdmin) {
		name = userIsAdmin ? name : await getUserFromCookie(cookie);
		const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		existingAccount.get({ $1: name });
		existingAccount.run();

		let userData = existingAccount.get();
		if (existingAccount.get() == null) {
			return profile404;
		}
		if (await isBanned(name.toLowerCase())) {
			let modified_ban = profileBan;
			modified_ban = modified_ban.replaceAll("{{ reason }}", userData.banned);
			return modified_ban;
		}
		let modifiedHTML = rawEditProfileHTML;
		modifiedHTML = modifiedHTML.replaceAll("{{ name }}", sanitizeHtml(userData.name, sanitizeConfig));
		modifiedHTML = modifiedHTML.replaceAll("{{ username }}", userData.username);
		modifiedHTML = modifiedHTML.replaceAll("{{ join_date }}", dayjs(userData.createdAt).fromNow());
		modifiedHTML = modifiedHTML.replaceAll("{{ about }}", sanitizeHtml(userData.about, sanitizeConfig) || "No about me available..");
		modifiedHTML = modifiedHTML.replaceAll("{{ user_pfp }}", userData.pfp_url || "/img/user.svg");
		modifiedHTML = modifiedHTML.replaceAll("{{ custom_css }}", userData.custom_css || "");
		modifiedHTML = modifiedHTML.replaceAll("{{ url_gen }}", `https://selenite.cc/u/${userData.username}`);
		modifiedHTML = modifiedHTML.replaceAll("{{ online_time }}", dayjs(userData.last_login).fromNow());
		modifiedHTML = modifiedHTML.replaceAll("{{ css_edit }}", (userData.badges ? userData.badges.length : 0) > 0 ? '<img src="/img/edit.svg" id="edit" />' : "");
		modifiedHTML = modifiedHTML.replaceAll("{{ played_games }}", buildGameHTML(userData));
		let badges_html = "";

		if (userData.badges !== null) {
			let badges = JSON.parse(userData.badges);
			for (let i = 0; i < badges.length; i++) {
				badges_html += `<img src="/img/badges/${badges[i]}.svg" class="badges" alt="${badge[badges[i]]}" title="${badge[badges[i]]}">`;
			}
		}
		modifiedHTML = modifiedHTML.replaceAll("{{ badges }}", badges_html);
		return modifiedHTML;
	}
}

async function loginAccount(name, pass, captcha) {
	const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		
	let userData = existingAccount.get({ $1: name });
	if (userData == null) {
		return { success: false, reason: "The account doesn't exists." };
	}
	const response = await axios.post("https://api.hcaptcha.com/siteverify", `response=${captcha}&secret=${process.env.HCAPTCHA_SECRET}`);

	const data = response.data;

	if (!data.success) {
		return { success: false, reason: "Captcha failed." };
	}
	let account_pass = JSON.parse(userData.hashed_pass);
	const salted_pass = pass + account_pass.salt;
	const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");

	if (account_pass.pass == new_pass) {
		const updateAccount = accs.query(`UPDATE accounts SET last_login = $login WHERE username = $user`)
		updateAccount.get({ $login: new Date().toUTCString(), $user: name.toLowerCase() });
		return { success: true, token: await generateCookie(name, pass) };
	} else {
		return { success: false, reason: "Incorrect password." };
	}
}

async function generateCookie(name, pass) {
	let date = new Date();
	date.setMonth(date.getMonth() + 6);
	let unencryptedCookie = JSON.stringify({ n: name, p: pass, e: date });

	const secretKey = process.env.AUTH_KEY;
	const iv = crypto.randomBytes(16);

	const cipher = crypto.createCipheriv("aes-256-cbc", secretKey, iv);
	let encrypted = cipher.update(unencryptedCookie, "utf8", "base64");
	encrypted += cipher.final("base64");

	const encryptedCookie = (iv.toString("base64") + "." + encrypted).replaceAll("=", "");
	return encryptedCookie;
}

async function verifyCookie(cookie) {
	let decrypted = JSON.parse(await decryptCookie(cookie));
	if (decrypted) {
		return (await isLoginValid(decrypted["n"], decrypted["p"])) && new Date(decrypted["e"]) > new Date();
	}
	return false;
}

async function getUserFromCookie(cookie) {
	return await JSON.parse(await decryptCookie(cookie))["n"];
}

async function decryptCookie(cookie) {
	if (cookie) {
		try {
			const secretKey = process.env.AUTH_KEY;
			if (secretKey.length !== 32) {
				shitHitTheFan("Encryption key isn't valid");
				return false;
			}
			let tokenSplit = cookie.split(".");
			if (tokenSplit.length !== 2) {
				return false;
			}
			const iv = Buffer.from(tokenSplit[0], "base64");
			let encryptedData = Buffer.from(tokenSplit[1], "base64");
			let cipher = crypto.createDecipheriv("aes-256-cbc", secretKey, iv);
			let decrypted = cipher.update(encryptedData, "base64", "utf8");
			decrypted += cipher.final("utf8");
			if (decrypted) {
				return decrypted;
			} else {
				return false;
			}
		} catch (e) {
			console.error(e);
			return false;
		}
	}
}

async function isLoginValid(name, pass) {
	const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
	
	let userData = existingAccount.get({ $1: name });
	if (userData == null) {
		return false;
	}
	let account_pass = JSON.parse(userData.hashed_pass);
	const salted_pass = pass + account_pass.salt;
	const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");

	return userData && account_pass.pass == new_pass;
}

async function editProfile(body, token, admin) {
	let userIsAdmin = false;
	if(admin) {
		userIsAdmin = await isAdmin(token);
	}
	if (await verifyCookie(token) || userIsAdmin) {
		console.log(body.pfp);
		let user = userIsAdmin ? await getUserFromCookie(token) : body.username;

		const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`);
		
		let userData = existingAccount.get({ $1: user });
		if (userData == null) {
			return { success: false, reason: "The account doesn't exists. (if you see this we fucked LMFAOOOO)" };
		}

		if (body.name) {
			if (body.name.length > 20) {
				return { success: false, reason: "Length too long." };
			}
			const updateAccount = accs.query(`UPDATE accounts SET name = $name WHERE username = $user`)
			updateAccount.get({ $name: body.name, $user: user });
		}
		if (body.about) {
			if (body.about.length > 200) {
				return { success: false, reason: "Length too long." };
			}
			const updateAccount = accs.query(`UPDATE accounts SET about = $about WHERE username = $user`)
			updateAccount.get({ $about: body.about, $user: user });
		}
		if (body.custom) {
			const updateAccount = accs.query(`UPDATE accounts SET custom_css = $css WHERE username = $user`)
			updateAccount.get({ $css: body.custom, $user: user });
		}
		if (body.pfp) {
			console.log("hit body pfp");
			if(body.pfp == "del") {
				const updateAccount = accs.query(`UPDATE accounts SET pfp_url = null WHERE username = $user`)
				updateAccount.get({ $name: body.name, $user: user });
				return { success: true };
			}
			const { fileTypeFromBuffer } = await import("file-type");
			let base64Data = body.pfp.split(";base64,").pop();
			let pfp = Buffer.from(base64Data, "base64");
			let fileType = (await fileTypeFromBuffer(pfp))["ext"];
			if (["png", "jpg", "gif", "avif", "webp", "tiff"].includes(fileType)) {
				let url;
				let dir = `${process.env.DATA_PATH}/data/${existingAccount.id}/`;
				let uuid = crypto.randomUUID();
				let path = `${process.env.DATA_PATH}/data/${existingAccount.id}/${uuid}.webp`;
				url = `/data/${existingAccount.id}/${uuid}.webp`;
				fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(path, "");
				await sharp(pfp, { animated: fileType == "gif" })
					.resize({ width: 300, withoutEnlargement: true })
					.webp({ quality: 70, effort: 4 })
					.toFile(path);
				await fs.unlink(`${__dirname}/${existingAccount.pfp_url}`, () => {});
				const updateAccount = accs.query(`UPDATE accounts SET pfp_url = $url WHERE username = $user`)
				updateAccount.get({ $url: url, $user: user });
			}
		}

		return { success: true };
	}

	return { success: false };
}

async function addBadge(user, badge, cookie) {
	if (await isAdmin(cookie)) {
		const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		let userData = existingAccount.get({ $1: user });
		if (userData == null) {
			return { success: false, reason: "The account doesn't exists." };
		}
		let badges;
		if (userData.badges !== null) {
			badges = JSON.parse(userData.badges);
		} else {
			badges = [];
		}
		if (badges.includes(badge)) {
			badges.splice(badges.indexOf(badge), 1);
		} else {
			badges.push(badge);
		}
		const updateAccount = accs.query(`UPDATE accounts SET badges = $badge WHERE username = $user`)
		updateAccount.get({ $badges: JSON.stringify(badges), $user: user.toLowerCase() });
		return { success: true };
	}

	return { success: false };
}

async function removeAccount(user, cookie) {
	if (await isAdmin(cookie)) {
		const updateAccount = accs.query(`DELETE FROM accounts WHERE username = $user`)
		updateAccount.get({ $user: user.toLowerCase() });
		return true;
	}
}

async function isAdmin(token) {
	if (token) {
		let user = JSON.parse(await decryptCookie(token))["n"];

		let existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		let userData = existingAccount.get({ $1: user });
		if (userData == null) {
			return false;
		}

		return userData.type == "admin";
	}
	return false;
}

async function saveData(token, data) {
	if (data["cookies"] && data["localStorage"]) {
		let user = JSON.parse(await decryptCookie(token))["n"];

		const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		let userData = existingAccount.get({ $1: user });
		if (userData == null) {
			return { success: false, reason: "Does not exist" };
		}
		let path = `${process.env.DATA_PATH}/data/${userData.id}/save.dat`;
		let dir = `${process.env.DATA_PATH}/data/${userData.id}/`;
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path, "");

		const iv = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv("aes-256-cbc", process.env.AUTH_KEY, iv);
		let encrypted = cipher.update(JSON.stringify(data), "utf8", "base64");
		encrypted += cipher.final("base64");
		try {
			fs.writeFileSync(path, (iv.toString("base64") + "." + encrypted).replaceAll("=", ""));
			return { success: true };
		} catch (err) {
			console.error(err);
		}
	}
	return { success: false, reason: "Anonymous error" };
}

async function retrieveData(token) {
	let user = JSON.parse(await decryptCookie(token))["n"];
	console.log(user);

	const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
	let userData = existingAccount.get({ $1: user });
	console.log(userData);
	if (userData == null) {
		return { success: false, reason: "Does not exist" };
	}
	let path = `${process.env.DATA_PATH}/data/${userData.id}/save.dat`;
	console.log(path);
	let result;
	fs.exists(path, (e)=>{result=e});
	if(!result) {
		return { success: false, reason: "No data was found." }
	}
	try {
		let data = fs.readFileSync(path, "utf-8");
		const iv = Buffer.from(data.split(".")[0], "base64");
		data = data.split(".")[1];
		let cipher = crypto.createDecipheriv("aes-256-cbc", process.env.AUTH_KEY, iv);
		let decrypted = cipher.update(data, "base64", "utf8");
		decrypted += cipher.final("utf8");
		return { success: true, data: decrypted };
	} catch (err) {
		console.error(err);
		shitHitTheFan("Failure retrieving data, either database is messed up or something else.");
		shitHitTheFan("User info: " + user + ", " + path);
	}
	return { success: false, reason: "Anonymous error" };
}

async function getRawData(token) {
	let name = await getUserFromCookie(token);
	const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
	let userData = existingAccount.get({ $1: name });
	if (userData == null) {
		return { success: false, reason: "Does not exist" };
	}

	return {
		username: userData.username,
		name: userData.name,
		about: userData.about,
		badges: userData.badges,
		pfp: userData.pfp_url,
		css: userData.custom_css,
		game_time: userData.playedgames,
	};
}

async function getUsers(page, search) {
	let amount = 12;
	if (!page) {
		page = 0;
	}
	const getUsersSQL = accs.query(`SELECT * FROM accounts WHERE username LIKE $search AND banned IS NULL LIMIT $limit OFFSET $offset`);
	let data = getUsersSQL.all({ $search: `%${search}%`, $limit: amount, $offset: page * amount });
	let countUsers = accs.query(`SELECT COUNT(*) FROM accounts`);

	let finalData = { users: {}, count: countUsers.get()["COUNT(*)"] };

	for (let i = 0; i < data.length; i++) {
		finalData.users[i] = {
			username: sanitizeHtml(data[i].username, sanitizeConfig),
			name: sanitizeHtml(data[i].name, sanitizeConfig),
			about: (data[i].about + "").length > 50 ? `${(sanitizeHtml(data[i].about, sanitizeConfigNoLink) + "").substring(0, 50)}...` : sanitizeHtml(data[i].about, sanitizeConfigNoLink),
			badges: data[i].badges,
			pfp_url: data[i].pfp_url || "/img/user.svg",
		};
	}


	return finalData;
}

async function banUser(name, reason, token) {
	if (await isAdmin(token)) {
		const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
		let userData = existingAccount.get({ $1: name });
		if (userData == null) {
			return { success: false, reason: "Does not exist" };
		}
		const updateAccount = accs.query(`UPDATE accounts SET banned = $reason WHERE username = $user`)
		updateAccount.get({ $reason: reason, $user: name.toLowerCase() });
		return true;
	}
}

async function isBanned(user) {
	const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE ?1`)

	if (existingAccount.get({ $1: user }) == null) {
		return false;
	}
	if (existingAccount.banned) {
		return true;
	}
	return false;
}

function getFriends(id) {}

function shitHitTheFan(msg) {
	console.error("smth bad, ", msg);
	fetch("https://ntfy.sh/" + process.env.NTFY_ALERT, {
		method: "POST",
		body: msg,
	});
}

export { banUser, removeAccount, getUsers, getUserFromCookie, getRawData, retrieveData, saveData, createAccount, resetPassword, generateAccountPage, loginAccount, verifyCookie, editProfile, addBadge, isAdmin };
