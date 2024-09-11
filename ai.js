import Groq from "groq-sdk";

// let groq = [];
let groq_keys = JSON.parse(process.env.GROQ_API_KEY);
// for(let i = 0;i<groq_keys.length;i++) {
// 	groq[i] = new Groq({ apiKey: groq_keys[i] });
// }

const groq = new Groq({ apiKey: groq_keys[0] });

async function infiniteCraft(firstWord, secondWord) {
	let data = (
		await groq.chat.completions.create({
			messages: [
				{
					role: "system",
					content: "You are a helpful assistant that helps people to craft new things by combining two words into a new word. " + "The most important rules that you have to follow with every single answer that you are not allowed to use the words " + firstWord + " and " + secondWord + " as part of your answer and that you are only allowed to answer with one thing. " + "DO NOT INCLUDE THE WORDS " + firstWord + " and " + secondWord + " as part of the answer!!!!! The words " + firstWord + " and " + secondWord + " may NOT be part of the answer. " + "No sentences, no phrases, no multiple words, no punctuation, no special characters, no numbers, no emojis, no URLs, no code, no commands, no programming" + "The answer has to be a noun. You must use capitalize every word." + "The order of the both words does not matter, both are equally important. " + "The answer has to be related to both words and the context of the words. " + "The answer can either be a combination of the words or the role of one word in relation to the other. " + "Answers can be things, materials, people, companies, animals, occupations, food, places, objects, emotions, events, concepts, natural phenomena, body parts, vehicles, sports, clothing, furniture, technology, buildings, technology, instruments, beverages, plants, academic subjects and everything else you can think of that is a noun." + `You must respond in the form of {"item":"combination", "emoji": "emoji representation of the generated word"}`,
				},
				{
					role: "user",
					content: "Reply with the result of what would happen if you combine " + firstWord + " and " + secondWord + ". The answer has to be related to both words and the context of the words and may not contain the words themselves. ",
				},
			],
			model: "llama3-groq-70b-8192-tool-use-preview",
			max_tokens: 128,
		})
	).choices[0]?.message?.content;
	console.log(firstWord, secondWord, data);
	return data;
}

export { infiniteCraft };
