import { Octokit } from "@octokit/rest";
import { isCowJsonFile } from "./validation-helpers.js";

// Environment variables
const token = process.env.GITHUB_TOKEN;
const pr_number = Number(process.env.PR_NUMBER);
const repoFullName = process.env.GITHUB_REPOSITORY;
const octokit = new Octokit({ auth: token });

// Identify the PR
const [owner, repo] = repoFullName.split("/");

async function run() {
    try {
        const { data: pr } = await octokit.pulls.get({
            owner,
            repo,
            pull_number: pr_number
        });

        // --- Checking for previous validation faiures ---

        // Get all comments on the PR
        const { data: comments } = await octokit.issues.listComments({
            owner,
            repo,
            issue_number: pr_number
        });

        // Count all failure comments made by the bot
        const failComments = comments.filter(
            c => c.user.type === "Bot" &&
                c.body.includes("❌")
        );

        const failCount = failComments.length;

        // --- Start validation ---

        console.log(`🔍 Validating PR #${pr_number} from ${pr.user.login}`);

        // Get files in PR
        const { data: files } = await octokit.pulls.listFiles({
            owner,
            repo,
            pull_number: pr_number
        });

        const jsonFiles = files.filter(f => isCowJsonFile(f.filename));
        const imageFiles = files.filter(f => f.filename.startsWith("images/"));
        const requiredKeys = ["name", "breed", "image"];

        let commentString = `### 🧪 PR Validation Results for #${pr_number}\n\n`;

        // --- Basic pre-checks ---
        if (jsonFiles.length === 0) {
            commentString += `\n---\n\n`;
            commentString += "❌ No JSON file found! Please include your **<cow>.json** file.\n";
            if (failCount >= 3) {
                commentString += `\n\n⚠️ You have ${failCount} previous failed validation attempts. Please schedule a CSE session using your student dashboard.`;
            }
            await comment(commentString);
            process.exit(1);
        }

        // There should only be one JSON file in the PR
        if (jsonFiles.length > 1) {
            commentString += `\n---\n\n`;
            commentString += "❌ Multiple JSON files found! Please include only one **<cow>.json** file.\n";
            if (failCount >= 3) {
                commentString += `\n\n⚠️ You have ${failCount} previous failed validation attempts. Please schedule a CSE session using your student dashboard.`;
            }
            await comment(commentString);
            process.exit(1);
        }


        // --- Load and parse JSON file ---
        const file = jsonFiles[0];
        let data, rawContent;

        try {
            const response = await fetch(file.raw_url);
            const content = await response.text();
            data = JSON.parse(content);
            rawContent = content;
        } catch {
            commentString += `\n---\n\n`;
            commentString += `❌ File **${file.filename}** is not valid JSON!`;
            if (failCount >= 3) {
                commentString += `\n\n⚠️ You have ${failCount} previous failed validation attempts. Please schedule a CSE session using your student dashboard.`;
            }
            await comment(commentString);
            process.exit(1);
        }

        // Helper: check if referenced image exists
        const imageExists = imageFiles.some(img => img.filename === data.image);

        // Helper: validate JSON content before running field-based tests
        const missing = requiredKeys.filter(key => !data[key]);
        if (missing.length > 0) {
            commentString += `\n---\n\n`;
            commentString += `❌ File **${file.filename}** is missing: ${missing.join(", ")}. These are required for further validation.`;
            if (failCount >= 3) {
                commentString += `\n\n⚠️ You have ${failCount} previous failed validation attempts. Please schedule a CSE session using your student dashboard.`;
            }
            await comment(commentString);
            process.exit(1);
        }

        // --- Tests ---
        const testsToRun = [
            {
                name: "Check PR is going to correct repo",
                test: ({ pr }) =>
                    pr.base.repo.owner.login === "codeday",
                failMsg:
                    "❌ It looks like your PR is not pointing to the codeday repo. You need to open it **from your fork** to the main **codeday repo**."
            },
            {
                name: "Check image path",
                test: ({ data }) => data.image?.startsWith("images/"),
                failMsg:
                    `❌ Image path in **${file.filename}** must start with "images/".`
            },
            {
                name: "Check image file exists",
                test: ({ data, imageExists }) => imageExists,
                failMsg:
                    `❌ Image file **${data.image}** specified in **${file.filename}** does not exist in the PR.`
            },
            {
                name: "Check image file size",
                test: async ({ data, imageFiles }) => {
                    const MAX_SIZE = 250000; // 250 KB (some leeway for OS rounding)
                    const imageFile = imageFiles.find(f => f.filename === data.image);

                    if (!imageFile) return false;

                    try {
                        const response = await fetch(imageFile.raw_url);
                        const buffer = await response.arrayBuffer();
                        return buffer.byteLength <= MAX_SIZE;
                    } catch (err) {
                        console.warn(`⚠️ Could not fetch image for size check: ${data.image}`, err);
                        return false;
                    }
                },
                failMsg:
                    "❌ Image file is too large! Maximum allowed size is **200 KB**. Please resize or compress it and update your PR."
            },
            {
                name: "Check file naming convention",
                test: ({ data }) => {
                    const normalisedName = data.name.toLowerCase().replace(/ /g, '_');
                    const expectedImageNamePng = `images/${normalisedName}.png`;
                    const expectedImageNameJpg = `images/${normalisedName}.jpg`;
                    const expectedImageNameJpeg = `images/${normalisedName}.jpeg`;
                    return (
                        data.image === expectedImageNamePng ||
                        data.image === expectedImageNameJpg ||
                        data.image === expectedImageNameJpeg
                    );
                },
                failMsg:
                    `❌ Image file name in **${file.filename}** should be based on the cow's name. Expected: images/${data.name.toLowerCase().replace(/ /g, '_')}.png or .jpg or .jpeg`
            },
            {
                name: "Check proper indentation",
                test: ({ rawContent }) => {
                    const lines = rawContent.split("\n");
                    return lines.every(line => {
                        const trimmed = line.trim();
                        if (trimmed === "{" || trimmed === "}" || trimmed === "") return true;
                        return line.startsWith("    ") && !line.startsWith("        ");
                    });
                },
                failMsg: `❌ File **${file.filename}** is not properly indented.`
            },
            {
                name: "Check line endings",
                test: ({ rawContent }) => !rawContent.includes("\r\n"),
                failMsg: `❌ File **${file.filename}** contains Windows-style line endings (CRLF). Please convert to Unix-style (LF) line endings.`
            }
        ];

        // --- Run tests ---
        let testsPassed = 0;

        for (const testObj of testsToRun) {
            let result = testObj.test({ pr, data, file, imageExists, rawContent, imageFiles });

            if (result instanceof Promise) {
                result = await result;
            }

            const valid = result === true;

            if (valid) {
                commentString += `✅ **${testObj.name}** passed!\n`;
                testsPassed++;
            } else {
                const failMessage =
                    typeof testObj.failMsg === "function"
                        ? testObj.failMsg({ data, file, imageExists, rawContent, imageFiles })
                        : testObj.failMsg;
                commentString += `${failMessage}\n`;
            }
        }

        commentString += `\n---\n\n`;

        if (testsPassed === testsToRun.length) {
            commentString += `✅ All tests passed! Nice work on your PR! 🎉`;
            await comment(commentString);
            process.exit(0);
        } else {
            commentString += `❌ ${testsPassed}/${testsToRun.length} passed. Please fix the issues above and update your PR.`;
            if (failCount >= 3) {
                commentString += `\n\n⚠️ You have ${failCount} previous failed validation attempts. Please schedule a CSE session using your student dashboard.`;
            }
            await comment(commentString);
            process.exit(1);
        }

    } catch (err) {
        console.error("Error validating PR:", err);
        process.exit(1);
    }
}

// Helper: Comment on the PR
async function comment(message) {
    await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pr_number,
        body: message,
    });
}

run();
