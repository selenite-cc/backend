import "dotenv/config";
import { log } from "./log.js";
import { Sequelize, DataTypes, Op } from "sequelize";

const sequelize = new Sequelize({
	logging: msg => console.log(log.info(msg)),
	dialect: "sqlite",
	storage: `${process.env.DATA_PATH}/accounts.sqlite`,
});

const account_db = sequelize.define("accounts", {
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
});
sequelize.sync().then(() => {
    console.log(log.success("Database is online."));
}).catch((error) => {
    console.error(log.error("Failed to synchronize database:"));
	console.error(log.error(error));
});

export { sequelize, account_db };