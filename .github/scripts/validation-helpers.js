export function isCowJsonFile(filename) {
    return filename.startsWith("cows/") && filename.endsWith(".json");
}

export function isValidatorMaintenancePullRequest(files) {
    const allowedFiles = new Set([
        ".github/workflows/validate-pr.yml",
        "package-lock.json",
        "package.json"
    ]);

    return files.length > 0 && files.every(({ filename }) =>
        filename.startsWith(".github/scripts/") || allowedFiles.has(filename)
    );
}
