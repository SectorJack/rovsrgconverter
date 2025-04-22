/**
 * @param {string} data
 * @param {boolean} use_single_quotes
 * @param {number} level
 * @param {"dynamic"|"fixed"|"huffman_only"} strategy
 * @returns {string}
 * @description Compresses the given data using pako and Base91.
 */
function compress(data, use_single_quotes = false, level = 6, strategy = 'dynamic') {
    let compressed = pako.deflate(data, {
        level: level, 
        strategy: pako[strategy.toUpperCase()] || pako.Z_DEFAULT_STRATEGY
    });

    let base91encoded = base91.encode(compressed);

    if (use_single_quotes) {
        base91encoded = base91encoded.replace(/"/g, "'");
    }

    return base91encoded;
}

/**
 * @param {string} data 
 * @param {boolean} use_single_quotes 
 * @returns {string}
 * @description Decompresses the given data using pako and Base91.
 */
function decompress(data, use_single_quotes = false) {
    if (use_single_quotes) {
        data = data.replace(/'/g, '"');
    }

    let decoded = base91.decode(data);
    let decompressed = pako.inflate(decoded, { to: 'string' });

    return decompressed;
}