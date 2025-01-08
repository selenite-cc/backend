import crypto from "node:crypto";
import { accs } from "../database.js";
import { rword } from "rword";
import axios from "axios";
import { fileURLToPath } from "url";
import path, { dirname } from "path";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


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
	if(cookie){
		let decrypted = JSON.parse(await decryptCookie(cookie));
		if (decrypted) {
			return (await isLoginValid(decrypted["n"], decrypted["p"])) && new Date(decrypted["e"]) > new Date();
		}
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
			return {};
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

export { banUser, removeAccount, verifyCookie, getUserFromCookie, createAccount, resetPassword, loginAccount, addBadge, isBanned, decryptCookie };
