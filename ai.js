import Groq from "groq-sdk";

let groq = [];
let groq_keys = JSON.parse(process.env.GROQ_API_KEY);
for(let i = 0;i<groq_keys.length;i++) {
	groq[i] = new Groq({ apiKey: groq_keys[i] });
}

//const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function getGroqChatCompletion(message) {
	return groq[Math.floor(Math.random() * groq_keys.length)].chat.completions.create({
		messages: [
			{
				role: "system",
				content: "Generate the exact CSS code to achieve the user's specified design requirements. Return only plain CSS code, targeting --uibg, --textcolor, and --bg variables using body.profile. Include any additional styles or features as requested, such as animations or custom properties. Return only the CSS code, without any additional text, explanations, or formatting. Do not include any markdown syntax, such as headers, bold or italic text, or code blocks. The response should consist only of plain CSS code, with no extraneous characters or whitespace.",
			},
			{
				role: "user",
				content: message,
			},
		],
		model: "llama-3.1-70b-versatile",
		max_tokens: 2048,
	});
}

export { getGroqChatCompletion };
