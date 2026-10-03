require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');

const {
  DISCORD_TOKEN,
  GROK_API_KEY,
  CHANNEL_ID,
  GROK_MODEL = 'grok-4-fast',
  GROK_BASE_URL = 'https://api.x.ai/v1',
} = process.env;

if (!DISCORD_TOKEN || !GROK_API_KEY || !CHANNEL_ID) {
  console.error('Missing DISCORD_TOKEN, GROK_API_KEY or CHANNEL_ID in .env');
  process.exit(1);
}

const SYSTEM_PROMPT = `You are "Roblox Helper", a Discord bot that ONLY helps with Roblox Studio.
Topics allowed: Luau scripting, Roblox Studio tools, UI (ScreenGui/Frames), DataStores, RemoteEvents/Functions,
physics, animations, modeling, lighting, terrain, publishing, performance, game design inside Roblox.

If the question is NOT about Roblox Studio/Roblox development, reply ONLY with:
"I can only help with Roblox Studio related questions."

Formatting rules (Discord markdown):
- Use **bold** for important terms and step titles.
- Put ALL code inside \`\`\`lua code blocks.
- Use short numbered steps and bullet points.
- Mention where the script goes (e.g. ServerScriptService, StarterPlayerScripts).
- Be concise and accurate. Use modern Roblox API (task.wait, not wait).`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const history = new Map();   // userId -> last messages
const cooldown = new Map();  // userId -> timestamp
const COOLDOWN_MS = 5000;

async function askGrok(userId, question) {
  const past = history.get(userId) ?? [];
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...past,
    { role: 'user', content: question },
  ];

  const res = await fetch(`${GROK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROK_API_KEY}`,
    },
    body: JSON.stringify({ model: GROK_MODEL, messages, temperature: 0.3 }),
  });

  if (!res.ok) throw new Error(`Grok API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content?.trim() || 'No answer received.';

  const updated = [...past, { role: 'user', content: question }, { role: 'assistant', content: answer }];
  history.set(userId, updated.slice(-8));
  return answer;
}

// Split long text into embed-sized chunks without breaking code blocks
function splitText(text, max = 3800) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > max) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current);

  let open = false;
  return chunks.map((chunk) => {
    let c = chunk;
    if (open) c = '```lua\n' + c;
    const fences = (chunk.match(/```/g) || []).length;
    if (fences % 2 === 1) open = !open;
    if (open) c += '\n```';
    return c;
  });
}

client.once(Events.ClientReady, (c) => console.log(`✅ Logged in as ${c.user.tag}`));

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== CHANNEL_ID) return;
  if (!message.content.trim()) return;

  const last = cooldown.get(message.author.id) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return message.reply({
      content: '⏳ Please wait a few seconds before asking again.',
      allowedMentions: { repliedUser: false },
    });
  }
  cooldown.set(message.author.id, Date.now());

  try {
    await message.channel.sendTyping();
    const answer = await askGrok(message.author.id, message.content);
    const parts = splitText(answer);

    const embeds = parts.slice(0, 10).map((part, i) =>
      new EmbedBuilder()
        .setColor(0xe2231a)
        .setTitle(i === 0 ? '🧱 Roblox Studio Helper' : `Part ${i + 1}`)
        .setDescription(part)
        .setFooter({ text: `Asked by ${message.author.username} • Powered by Grok` })
    );

    await message.reply({ embeds, allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.error(err);
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('❌ Error')
      .setDescription('Something went wrong while contacting the AI. Try again later.');
    message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
  }
});

client.login(DISCORD_TOKEN); 
