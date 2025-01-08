import fs from "bun:fs";
import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { accs } from "../database.js";
import { getUserFromCookie, isBanned, decryptCookie, verifyCookie } from "./manage.js";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
dayjs.extend(relativeTime);

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

async function retrieveData(token) {
    let user = JSON.parse(await decryptCookie(token))["n"];

    const existingAccount = accs.query(`SELECT * FROM accounts WHERE username LIKE $1`)
    let userData = existingAccount.get({ $1: user });
    if (userData == null) {
        return { success: false, reason: "Does not exist" };
    }
    let path = `${process.env.DATA_PATH}/data/${userData.id}/save.dat`;
    
    let file = Bun.file(path)


    if(!(await file.exists())) {
        return { success: false, reason: "No data was found." }
    }
    try {
        let data = await file.text();
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

        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-cbc", process.env.AUTH_KEY, iv);
        let encrypted = cipher.update(JSON.stringify(data), "utf8", "base64");
        encrypted += cipher.final("base64");
        try {
            Bun.write(path, (iv.toString("base64") + "." + encrypted).replaceAll("=", ""));
            return { success: true };
        } catch (err) {
            console.error(err);
        }
    }
    return { success: false, reason: "Anonymous error" };
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


async function editProfile(body, token, admin) {
    let userIsAdmin = false;
    if(admin) {
        userIsAdmin = await isAdmin(token);
    }
    if (await verifyCookie(token) || userIsAdmin) {
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
		let userData = existingAccount.get({ $1: name });

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
export { getRawData, generateAccountPage, editProfile, saveData, getUsers, isAdmin, retrieveData };