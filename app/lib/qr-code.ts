const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const SIZE = 21;
const DATA_CODEWORDS = 19;
const ECC_CODEWORDS = 7;

function appendBits(target: number[], value: number, length: number) {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push((value >>> bit) & 1);
}

function multiply(x: number, y: number) {
  let result = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((y >>> bit) & 1) * x;
  }
  return result;
}

function divisor(degree: number) {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let coefficient = 0; coefficient < result.length; coefficient += 1) {
      result[coefficient] = multiply(result[coefficient], root);
      if (coefficient + 1 < result.length) result[coefficient] ^= result[coefficient + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function remainder(data: number[], generator: number[]) {
  const result = Array<number>(generator.length).fill(0);
  for (const value of data) {
    const factor = value ^ result.shift()!;
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] ^= multiply(coefficient, factor);
    });
  }
  return result;
}

function encodedCodewords(value: string) {
  const text = value.toUpperCase();
  if (!text || text.length > 25 || [...text].some((character) => !ALPHANUMERIC.includes(character))) {
    throw new Error("QR value must contain 1–25 alphanumeric QR characters.");
  }

  const bits: number[] = [];
  appendBits(bits, 0b0010, 4);
  appendBits(bits, text.length, 9);
  for (let index = 0; index < text.length; index += 2) {
    const first = ALPHANUMERIC.indexOf(text[index]);
    if (index + 1 < text.length) appendBits(bits, first * 45 + ALPHANUMERIC.indexOf(text[index + 1]), 11);
    else appendBits(bits, first, 6);
  }

  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);

  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);
  return [...data, ...remainder(data, divisor(ECC_CODEWORDS))];
}

function formatBits(mask: number) {
  const data = (0b01 << 3) | mask;
  let remainderValue = data;
  for (let index = 0; index < 10; index += 1) {
    remainderValue = (remainderValue << 1) ^ ((remainderValue >>> 9) * 0x537);
  }
  return ((data << 10) | remainderValue) ^ 0x5412;
}

export function createQrMatrix(value: string) {
  const modules = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  const functions = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));

  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = dark;
    functions[y][x] = true;
  };

  for (let index = 0; index < SIZE; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }

  const drawFinder = (centerX: number, centerY: number) => {
    for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
      for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
        const distance = Math.max(Math.abs(offsetX), Math.abs(offsetY));
        setFunction(centerX + offsetX, centerY + offsetY, distance !== 2 && distance !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(SIZE - 4, 3);
  drawFinder(3, SIZE - 4);

  const format = formatBits(0);
  const bit = (index: number) => ((format >>> index) & 1) !== 0;
  for (let index = 0; index <= 5; index += 1) setFunction(8, index, bit(index));
  setFunction(8, 7, bit(6));
  setFunction(8, 8, bit(7));
  setFunction(7, 8, bit(8));
  for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, bit(index));
  for (let index = 0; index < 8; index += 1) setFunction(SIZE - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index += 1) setFunction(8, SIZE - 15 + index, bit(index));
  setFunction(8, SIZE - 8, true);

  const dataBits: number[] = [];
  encodedCodewords(value).forEach((codeword) => appendBits(dataBits, codeword, 8));
  let dataIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (functions[y][x]) continue;
        const masked = Boolean(dataBits[dataIndex]) !== ((x + y) % 2 === 0);
        modules[y][x] = masked;
        dataIndex += 1;
      }
    }
  }

  return modules;
}
