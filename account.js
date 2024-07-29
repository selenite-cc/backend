import crypto from "node:crypto";
import { account_db } from "./database.js";
import { rword } from "rword";
import { Op } from "sequelize";
import fs from "node:fs";
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

		const existingAccounts = await account_db.findOne({ where: { username: name.toLowerCase() } });
		if (existingAccounts !== null) {
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
		await account_db.create({ id: id, username: name.toLowerCase(), name: name, hashed_pass: hash_pass, secret_key: secret_key });
		await account_db.update({ last_login: new Date().toUTCString() }, { where: { username: name.toLowerCase() } });

		return { success: true, key: secret_key };
	} catch (e) {
		shitHitTheFan("Account failed to create, probably something bad happened");
		shitHitTheFan("User info: " + name + ", " + pass);
		console.error("Error:", e);
		return { success: false, reason: e.message };
	}
}

async function generateAccount() {
	let name = rword.generate(2, { length: "3-7" }).join("_").toLowerCase();
	const id = `${Date.now()}${Math.round(Math.random() * 1000000)
		.toString()
		.padStart(6, 0)}`;
	const salt = crypto.randomBytes(128).toString("base64");
	const salted_pass = crypto.randomBytes(128).toString("base64") + salt;
	const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");
	const hash_pass = JSON.stringify({ pass: new_pass, salt: salt });
	let secret_key = rword.generate(6, { length: "3-7" }).join(" ").toUpperCase();
	await account_db.create({ id: id, username: name.toLowerCase(), name: name.toUpperCase(), hashed_pass: hash_pass, secret_key: secret_key, about: rword.generate(15, { length: "3-7" }).join(" "), pfp_url: "data/1721513763555645200/fa4ee75a-35dc-4ed5-b6d4-7239f0342c4e.webp" });
}

async function resetPassword(name, key, pass, captcha) {
	const response = await axios.post("https://api.hcaptcha.com/siteverify", `response=${captcha}&secret=${process.env.HCAPTCHA_SECRET}`);

	const data = response.data;

	if (!data.success) {
		return { success: false, reason: "Captcha failed." };
	}
	key = key.toUpperCase();
	const existingAccount = await account_db.findOne({ where: { username: name.toLowerCase() } });
	if (existingAccount == null) {
		return { success: false, reason: "The account does not exist." };
	}

	if (existingAccount.secret_key == key) {
		const salt = crypto.randomBytes(128).toString("base64");
		const salted_pass = pass + salt;
		const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");
		const hash_pass = JSON.stringify({ pass: new_pass, salt: salt });
		await account_db.update({ hashed_pass: hash_pass }, { where: { username: name.toLowerCase() } });
		return { success: true };
	} else {
		return { success: false, reason: "Wrong key" };
	}
}

async function generateAccountPage(name, cookie) {
	if (name) {
		const existingAccount = await account_db.findOne({ where: { username: name.toLowerCase() } });
		if (existingAccount == null || await isBanned(name.toLowerCase())) {
			return profile404;
		}

		let modifiedHTML = rawProfileHTML;
		modifiedHTML = modifiedHTML.replaceAll("{{ name }}", sanitizeHtml(existingAccount.name, allowNone));
		modifiedHTML = modifiedHTML.replaceAll("{{ join_date }}", dayjs(existingAccount.createdAt).fromNow());
		modifiedHTML = modifiedHTML.replaceAll("{{ about }}", sanitizeHtml(existingAccount.about, sanitizeConfig) || "No about me available..");
		modifiedHTML = modifiedHTML.replaceAll("{{ about_none }}", sanitizeHtml(existingAccount.about, allowNone) || "");
		modifiedHTML = modifiedHTML.replaceAll("{{ user_pfp }}", existingAccount.pfp_url || "/img/user.svg");
		modifiedHTML = modifiedHTML.replaceAll("{{ custom_css }}", existingAccount.custom_css || "");
		modifiedHTML = modifiedHTML.replaceAll("{{ online_time }}", dayjs(existingAccount.last_login).fromNow());
		let badges_html = "";

		if (existingAccount.badges !== null) {
			let badges = JSON.parse(existingAccount.badges);
			for (let i = 0; i < badges.length; i++) {
				badges_html += `<img src="/img/badges/${badges[i]}.svg" class="badges" alt="${badge[badges[i]]}" title="${badge[badges[i]]}">`;
			}
		}
		modifiedHTML = modifiedHTML.replaceAll("{{ badges }}", badges_html);
		return modifiedHTML;
	} else if (cookie) {
		name = await getUserFromCookie(cookie);
		const existingAccount = await account_db.findOne({ where: { username: name.toLowerCase() } });
		if (existingAccount == null) {
			return profile404;
		}
		if(await isBanned(name.toLowerCase())) {
			let modified_ban = profileBan;
			modified_ban = modified_ban.replaceAll("{{ reason }}", existingAccount.banned);
			return modified_ban;
		}
		let modifiedHTML = rawEditProfileHTML;
		modifiedHTML = modifiedHTML.replaceAll("{{ name }}", sanitizeHtml(existingAccount.name, sanitizeConfig));
		modifiedHTML = modifiedHTML.replaceAll("{{ join_date }}", dayjs(existingAccount.createdAt).fromNow());
		modifiedHTML = modifiedHTML.replaceAll("{{ about }}", sanitizeHtml(existingAccount.about, sanitizeConfig) || "No about me available..");
		modifiedHTML = modifiedHTML.replaceAll("{{ user_pfp }}", existingAccount.pfp_url || "/img/user.svg");
		modifiedHTML = modifiedHTML.replaceAll("{{ custom_css }}", existingAccount.custom_css || "");
		modifiedHTML = modifiedHTML.replaceAll("{{ url_gen }}", `https://selenite.cc/u/${existingAccount.username}`);
		modifiedHTML = modifiedHTML.replaceAll("{{ online_time }}", dayjs(existingAccount.last_login).fromNow());
		modifiedHTML = modifiedHTML.replaceAll("{{ css_edit }}", (existingAccount.badges ? existingAccount.badges.length : 0) > 0 ? '<img src="/img/edit.svg" id="edit" />' : "");
		let badges_html = "";

		if (existingAccount.badges !== null) {
			let badges = JSON.parse(existingAccount.badges);
			for (let i = 0; i < badges.length; i++) {
				badges_html += `<img src="/img/badges/${badges[i]}.svg" class="badges" alt="${badge[badges[i]]}" title="${badge[badges[i]]}">`;
			}
		}
		modifiedHTML = modifiedHTML.replaceAll("{{ badges }}", badges_html);
		return modifiedHTML;
	}
}

async function loginAccount(name, pass, captcha) {
	const existingAccounts = await account_db.findOne({ where: { username: name.toLowerCase() } });
	if (existingAccounts == null) {
		return { success: false, reason: "The account doesn't exists." };
	}
	const response = await axios.post("https://api.hcaptcha.com/siteverify", `response=${captcha}&secret=${process.env.HCAPTCHA_SECRET}`);

	const data = response.data;

	if (!data.success) {
		return { success: false, reason: "Captcha failed." };
	}
	let account_pass = JSON.parse(existingAccounts.hashed_pass);
	const salted_pass = pass + account_pass.salt;
	const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");

	if (account_pass.pass == new_pass) {
		await account_db.update({ last_login: new Date().toUTCString() }, { where: { username: name.toLowerCase() } });
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
	console.log("cookie", encrypted);

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
	const existingAccounts = await account_db.findOne({ where: { username: name.toLowerCase() } });
	if (existingAccounts == null) {
		return false;
	}
	let account_pass = JSON.parse(existingAccounts.hashed_pass);
	const salted_pass = pass + account_pass.salt;
	const new_pass = crypto.createHash("sha256").update(salted_pass).digest("hex");

	return existingAccounts && account_pass.pass == new_pass;
}

async function editProfile(body, token) {
	if (await verifyCookie(token)) {
		let user = await getUserFromCookie(token);

		const existingAccount = await account_db.findOne({ where: { username: user } });
		if (existingAccount == null) {
			return { success: false, reason: "The account doesn't exists. (if you see this we fucked LMFAOOOO)" };
		}

		if (body.name) {
			if (body.name.length > 20) {
				return { success: false, reason: "Length too long." };
			}
			await account_db.update({ name: sanitizeHtml(body.name, sanitizeConfig) }, { where: { username: user } });
		}
		if (body.about) {
			if (body.about.length > 200) {
				return { success: false, reason: "Length too long." };
			}
			await account_db.update({ about: sanitizeHtml(body.about, sanitizeConfig) }, { where: { username: user } });
		}
		if (body.custom) {
			await account_db.update({ custom_css: sanitizeHtml(body.custom, sanitizeConfig) }, { where: { username: user } });
		}
		if (body.pfp) {
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
				await account_db.update({ pfp_url: url }, { where: { username: user } });
			}
		}

		return { success: true };
	}

	return { success: false };
}

async function addBadge(user, badge, cookie) {
	if (await isAdmin(cookie)) {
		const existingAccount = await account_db.findOne({ where: { username: user } });
		if (existingAccount == null) {
			return { success: false, reason: "The account doesn't exists." };
		}
		let badges;
		if (existingAccount.badges !== null) {
			badges = JSON.parse(existingAccount.badges);
		} else {
			badges = [];
		}
		if (badges.includes(badge)) {
			badges.splice(badges.indexOf(badge), 1);
		} else {
			badges.push(badge);
		}
		await account_db.update({ badges: JSON.stringify(badges) }, { where: { username: user } });
		return { success: true };
	}

	return { success: false };
}

async function removeAccount(user, cookie) {
	if(await isAdmin(cookie)) {
		await account_db.destroy({
			where: {
				username: user
			}
		})
		return true;
	}
}

async function isAdmin(token) {
	if (token) {
		let user = JSON.parse(await decryptCookie(token))["n"];

		const existingAccount = await account_db.findOne({ where: { username: user } });
		if (existingAccount == null) {
			return false;
		}

		return existingAccount.type == "admin";
	}
	return false;
}

async function saveData(token, data) {
	if (data["cookies"] && data["localStorage"]) {
		let user = JSON.parse(await decryptCookie(token))["n"];

		const existingAccount = await account_db.findOne({ where: { username: user } });
		if (existingAccount == null) {
			return { success: false, reason: "Does not exist" };
		}
		let path = `${process.env.DATA_PATH}/data/${existingAccount.id}/save.dat`;
		let dir = `${process.env.DATA_PATH}/data/${existingAccount.id}/`;
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

	const existingAccount = await account_db.findOne({ where: { username: user } });
	if (existingAccount == null) {
		return { success: false, reason: "Does not exist" };
	}
	let path = `${process.env.DATA_PATH}/data/${existingAccount.id}/save.dat`;
	try {
		await fs.access(path);
	} catch {
		return { success: false, reason: "No data was found." };
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
		shitHitTheFan("User info: " + user + ", " + path)
	}
	return { success: false, reason: "Anonymous error" };
}

async function getRawData(token) {
	let name = await getUserFromCookie(token);
	const existingAccounts = await account_db.findOne({ where: { username: name.toLowerCase() } });
	if (existingAccounts == null) {
		return { success: false, reason: "The account doesn't exist." };
	}

	return {
		username: existingAccounts.username,
		name: existingAccounts.name,
		about: existingAccounts.about,
		badges: existingAccounts.badges,
		pfp: existingAccounts.pfp_url,
		css: existingAccounts.custom_css,
		game_time: existingAccounts.playedgames,
	};
}

async function getUsers(page, search) {
	let amount = 12;
	if (!page) {
		page = 0;
	}
	let data = await account_db.findAndCountAll({
		offset: page * amount,
		limit: amount,
		where: {
			username: {
				[Op.like]: `%${search}%`,
			},
			banned: null,
		},
	});

	for (let i = 0; i < data.rows.length; i++) {
		data.rows[i] = {
			username: sanitizeHtml(data.rows[i].username, sanitizeConfig),
			name: sanitizeHtml(data.rows[i].name, sanitizeConfig),
			about: (data.rows[i].about + "").length > 50 ? `${(sanitizeHtml(data.rows[i].about, allowNone) + "").substring(0, 50)}...` : sanitizeHtml(data.rows[i].about, allowNone),
			badges: data.rows[i].badges,
			pfp_url: data.rows[i].pfp_url || "/img/user.svg",
		};
	}

	return data;
}

async function banUser(name, reason, token) {
	if(await isAdmin(token)) {
		const existingAccount = await account_db.findOne({ where: { username: name } });
		if (existingAccount == null) {
			return { success: false, reason: "Does not exist" };
		}
		await account_db.update({ banned: reason }, { where: { username: name.toLowerCase() } });
		return true;
	}
}

async function isBanned(user) {
	const existingAccount = await account_db.findOne({ where: { username: user } });
	if (existingAccount == null) {
		return false;
	}
	if(existingAccount.banned) {
		console.log("returning ban")
		return true;
	}
	return false;
}

function shitHitTheFan(msg) {
	fetch("https://ntfy.sh/" + process.env.NTFY_ALERT, {
		method: "POST",
		body: msg,
	});
}

export { banUser, removeAccount, generateAccount, getUsers, getUserFromCookie, getRawData, retrieveData, saveData, createAccount, resetPassword, generateAccountPage, loginAccount, verifyCookie, editProfile, addBadge, isAdmin };
