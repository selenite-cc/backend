import fg from "fast-glob";
import fs from "node:fs";
import { parse } from "node-html-parser";

const pattern = "./selenite/semag/*/cover.svg";
const files = await fg(pattern);

for (let i = 0; i < files.length; i++) {
	try {
		const data = fs.readFileSync(files[i], "utf8");
		const html = parse(data);
		console.log(html.querySelector("image"));
		fs.writeFileSync(files[i].slice(0, -9) + "cover.png", Buffer.from(html.querySelector("image").getAttribute("href").split(",")[1], "base64"));
	} catch (e) {
		console.log("Error: ", e);
		console.log(files[i]);
	}
}

const pattern2 = "./selenite/sppa/*/cover.svg";
const files2 = await fg(pattern2);

for (let i = 0; i < files2.length; i++) {
	try {
		const data = fs.readFileSync(files2[i], "utf8");
		const html = parse(data);
		console.log(html.querySelector("image"));
		fs.writeFileSync(files2[i].slice(0, -9) + "cover.png", Buffer.from(html.querySelector("image").getAttribute("href").split(",")[1], "base64"));
	} catch (e) {
		console.log("Error: ", e);
		console.log(files2[i]);
	}
}
