export function isCowJsonFile(filename) {
    return filename.startsWith("cows/") && filename.endsWith(".json");
}
