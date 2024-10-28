import { Database } from "bun:sqlite";

const accs = new Database(`${process.env.DATA_PATH}/accounts.sqlite`);
const infdb = new Database(`${process.env.DATA_PATH}/infinitecraft.sqlite`);

infdb.exec("PRAGMA journal_mode = WAL;");
accs.exec("PRAGMA journal_mode = WAL;");

export { accs, infdb };