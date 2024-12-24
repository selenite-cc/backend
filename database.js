import { Database } from "bun:sqlite";

const accs = new Database(`${process.env.DATA_PATH}/accounts.sqlite`);
const infdb = new Database(`${process.env.DATA_PATH}/infinitecraft.sqlite`);
const friends = new Database(`${process.env.DATA_PATH}/friends.sqlite`);
const polytrack = new Database(`${process.env.DATA_PATH}/polytrack.sqlite`);

infdb.exec("PRAGMA journal_mode = WAL;");
accs.exec("PRAGMA journal_mode = WAL;");
friends.exec("PRAGMA journal_mode = WAL;");
polytrack.exec("PRAGMA journal_mode = WAL;");

export { accs, infdb, friends,polytrack };