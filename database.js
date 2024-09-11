import "dotenv/config";
import { log } from "./log.js";
import { Sequelize, DataTypes, Op } from "sequelize";

const accs_sequelize = new Sequelize({
	logging: msg => console.log(log.info(msg)),
	dialect: "sqlite",
	storage: `${process.env.DATA_PATH}/accounts.sqlite`,
});

const account_db = accs_sequelize.define("accounts", {
	id: {
		type: DataTypes.INTEGER,
		allowNull: false,
		unique: true,
		primaryKey: true,
	},
	username: {
		type: DataTypes.TEXT,
		allowNull: true,
		unique: true,
	},
	name: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	hashed_pass: {
		type: DataTypes.INTEGER,
		allowNull: false,
	},
	secret_key: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	about: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	badges: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	last_login: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	playedgames: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	type: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	pfp_url: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	custom_css: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
	banned: {
		type: DataTypes.TEXT,
		allowNull: true,
	},
});

const infi_sequelize = new Sequelize({
	logging: msg => console.log(log.info(msg)),
	dialect: "sqlite",
	storage: `${process.env.DATA_PATH}/infinitecraft.sqlite`,
});

const infiniteCache = infi_sequelize.define("caches", {
	1: {
		type: DataTypes.TEXT,
	},
	2: {
		type: DataTypes.TEXT,
	},
	result_item: {
		type: DataTypes.TEXT,
	},
	result_emoji: {
		type: DataTypes.TEXT,
	},
});

infi_sequelize.sync().then(() => {
    console.log(log.success("Infinite Craft cache is online."));
}).catch((error) => {
    console.error(log.error("Failed to synchronize Infinite Craft database:"));
	console.error(log.error(error));
});

accs_sequelize.sync().then(() => {
    console.log(log.success("Accounts Database is online."));
}).catch((error) => {
    console.error(log.error("Failed to synchronize accs database:"));
	console.error(log.error(error));
});

export { accs_sequelize, infi_sequelize, account_db, infiniteCache };