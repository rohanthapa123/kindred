# Meme backdrop images

Drop images (png, jpg, webp, gif, avif) into the folder for the mood they should appear on:

| folder  | shown when                     | vibe                        |
|---------|--------------------------------|-----------------------------|
| found/  | you found the word             | sigma, gigachad, victory    |
| near/   | latest guess is rank #2–#25    | shocked, "SO CLOSE"         |
| hot/    | latest guess is rank 26–300    | confident, "he's cooking"   |
| warm/   | rank ≤ 2,000                   | curious, "oh?"              |
| cool/   | rank ≤ 10,000                  | unimpressed, "mid"          |
| cold/   | rank > 10,000                  | disappointed, crying, 💀    |
| letdown/| had a good guess, new one is far worse | "bro thought he had it" |
| lost/   | you gave up                    | "it's over"                 |
| dirty/  | guess is a rude / NSFW word    | "I'm watching you"          |

Images rotate with each guess, are shown at very low opacity in grayscale with soft faded edges,
and replace the emoji fallback for that mood. Folders are read at build time, so redeploy after adding.
Images with a **white background** (line-art rage faces etc.): name them `something.light.png` so the
white is blended away instead of showing as a grey box. Images with dark backgrounds need no suffix.

Only add images you have the rights to use.
