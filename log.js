import chalk from "chalk";

const log = {
	info: function (msg) {
		return chalk.gray.italic(msg);
	},
    success: function(msg) {
        return chalk.green(msg);
    },
    error: function(msg) {
        return chalk.red.bold(msg);
    }
};

export { log };
