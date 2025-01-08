function shitHitTheFan(msg) {
	console.error("smth bad, ", msg);
	fetch("https://ntfy.sh/" + process.env.NTFY_ALERT, {
		method: "POST",
		body: msg,
	});
}
export {  };