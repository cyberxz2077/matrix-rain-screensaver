// Small, dependency-free MP4 muxer for constant-rate, decode-ordered AVC samples.
// WebCodecs supplies AVC configuration and length-prefixed H.264 access units.
const u32 = (...values) => {
    const buffer = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => buffer.writeUInt32BE(value >>> 0, index * 4));
    return buffer;
};
const u16 = (...values) => {
    const buffer = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => buffer.writeUInt16BE(value, index * 2));
    return buffer;
};
const bytes = length => Buffer.alloc(length);
const text = value => Buffer.from(value, 'ascii');
const box = (type, ...parts) => {
    const payload = Buffer.concat(parts);
    return Buffer.concat([u32(payload.length + 8), text(type), payload]);
};
const fullBox = (type, flags, ...parts) => box(type, u32(flags), ...parts);
const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

export function muxH264({ width, height, fps, samples, configuration }) {
    if (!configuration?.length || !samples.length || !samples[0].key) {
        throw new Error('AVC configuration and an initial key frame are required');
    }
    samples.forEach((sample, index) => {
        if (sample.timestamp !== Math.round(index * 1e6 / fps)) {
            throw new Error('Only constant-rate samples without frame reordering are supported');
        }
    });
    const count = samples.length;
    const ftyp = box('ftyp', text('isom'), u32(512), text('isomiso2avc1mp41'));
    const keys = samples.flatMap((sample, index) => sample.key ? [index + 1] : []);
    const makeMoov = offset => box('moov',
        fullBox('mvhd', 0, u32(0, 0, fps, count, 0x10000), u16(0x100),
            bytes(10), matrix, bytes(24), u32(2)),
        box('trak',
            fullBox('tkhd', 7, u32(0, 0, 1, 0, count), bytes(8), u16(0, 0, 0, 0),
                matrix, u32(width * 65536, height * 65536)),
            box('mdia',
                fullBox('mdhd', 0, u32(0, 0, fps, count), u16(0x55c4, 0)),
                fullBox('hdlr', 0, u32(0), text('vide'), bytes(12), text('Matrix Rain\0')),
                box('minf',
                    fullBox('vmhd', 1, u16(0, 0, 0, 0)),
                    box('dinf', fullBox('dref', 0, u32(1), fullBox('url ', 1))),
                    box('stbl',
                        fullBox('stsd', 0, u32(1), box('avc1', bytes(6), u16(1), bytes(16),
                            u16(width, height), u32(0x480000, 0x480000, 0), u16(1),
                            bytes(32), u16(24, 0xffff), box('avcC', configuration))),
                        fullBox('stts', 0, u32(1, count, 1)),
                        fullBox('stsc', 0, u32(1, 1, count, 1)),
                        fullBox('stsz', 0, u32(0, count, ...samples.map(sample => sample.data.length))),
                        fullBox('stco', 0, u32(1, offset)),
                        fullBox('stss', 0, u32(keys.length, ...keys)))))));
    const moov = makeMoov(ftyp.length + makeMoov(0).length + 8);
    return Buffer.concat([ftyp, moov, box('mdat', ...samples.map(sample => sample.data))]);
}
