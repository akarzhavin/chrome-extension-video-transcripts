function parseVTT(vttString) {
    const subtitles = [];
    // Разбиваем текст на блоки (пустые строки)
    // Поддержка \r\n или \n
    const blocks = vttString.split(/(?:\r?\n){2,}/); 
    
    // Регулярка для захвата таймкодов
    const timeRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/;

    blocks.forEach(block => {
        const match = block.match(timeRegex);
        if (match) {
            // Парсим начало
            const startH = match[1] ? parseInt(match[1]) : 0;
            const startM = parseInt(match[2]);
            const startS = parseInt(match[3]);
            const startMs = parseInt(match[4]);
            const startTime = (startH * 3600) + (startM * 60) + startS + (startMs / 1000);

            // Парсим конец
            const endH = match[5] ? parseInt(match[5]) : 0;
            const endM = parseInt(match[6]);
            const endS = parseInt(match[7]);
            const endMs = parseInt(match[8]);
            const endTime = (endH * 3600) + (endM * 60) + endS + (endMs / 1000);

            // Достаем текст (всё, что после строки с таймкодом)
            const textPart = block.substring(match.index + match[0].length);
            // заодно чистим от HTML тегов (типа <b>, <i>, <v Name>)
            const text = textPart.trim().replace(/<[^>]+>/g, ''); 

            if (text) {
                subtitles.push({ startTime, endTime, text });
            }
        }
    });
    return subtitles;
}
