// Strings run bottom -> top. Optional locks name the collection color that opens each jar.
export const LEVELS = [
  { name: 'Первый сбор', lesson: 'gather', tubes: ['AABB', 'AABB', '', ''],
    tip: 'Нажми на △. Все открытые треугольники соберутся сами. Четыре одинаковых — готово!' },
  { name: 'Неполная партия', lesson: 'partial', tubes: ['AABB', 'BBAA', '', ''],
    tip: 'Собери △. Две конфеты останутся ждать: остальные спрятаны под ○.' },
  { name: 'Магнит-приёмник', lesson: 'receiver', tubes: ['A', 'ABBB', 'B', 'AA', '', ''],
    tip: 'Нажми на стопку с несколькими △. Они полетят к одиночному △: одноцветная стопка — приёмник.' },
  { name: 'Три цвета', lesson: 'practice', tubes: ['ABCC', 'BCAB', 'CAAB', '', ''],
    tip: 'Открывай спрятанные цвета. Магнит отмечает приёмник, стрелки показывают путь.' },
  { name: 'Береги место', lesson: 'space', tubes: ['ABCA', 'CBBA', 'ACBC', '', ''],
    tip: 'Попробуй начать с ○. Затем ищи ход, который откроет одноцветный приёмник.' },
  { name: 'Порядок важен', lesson: 'challenge', tubes: ['BDCA', 'CDAA', 'CDBB', 'ADBC', '', ''],
    tip: 'Четыре цвета, два пустых места. Планируй следующий сбор. Ошибку можно отменить.' },
  { name: 'Цветной замок', lesson: 'lock', tubes: ['AABB', 'BB', 'AA', ''],
    locks: [null, null, 'B', null],
    tip: 'Собери четыре △ — коралловый замок откроется. Закрытая банка пока не отдаёт и не принимает конфеты.' },
  { name: 'Что открыть первым?', lesson: 'lock-choice', tubes: ['AA', 'BB', 'AA', 'BB', 'CDCD', 'CCDD'],
    locks: [null, null, null, null, 'A', 'B'],
    tip: 'Сбор ○ откроет мятный замок, сбор △ — коралловый. Посмотри на конфеты внутри и выбери порядок.' },
  { name: 'Цепочка открытий', lesson: 'lock-chain', tubes: ['AABB', 'BB', 'AACC', 'CCDD', 'DD', ''],
    locks: [null, null, 'B', 'A', 'C', null],
    tip: 'Начни с △. Смотри, какие конфеты откроются за каждым замком: они помогут снять следующий.' },
  { name: 'Два пути', lesson: 'branch-space', tubes: ['ABDD', 'DAAC', 'ABBC', 'BDC', 'C', ''],
    locks: [null, null, 'D', null, null, null],
    tip: 'Сбор □ и сбор ◇ по-разному расходуют свободное место. Сравни, что каждый ход откроет дальше.' },
  { name: 'Скрытый ключ', lesson: 'hidden-key', tubes: ['', 'CAA', 'AAD', 'BDBD', 'DCC', 'CBB'],
    locks: [null, null, null, 'A', null, 'A'],
    tip: 'Замки ждут ○, но часть этих конфет пока закрыта другими цветами. Найди путь к ключу.' },
  { name: 'Три первых хода', lesson: 'three-paths', tubes: ['', 'D', 'CADA', 'BCAB', 'BCC', 'ADDB'],
    locks: [null, null, null, 'D', null, null],
    tip: 'Каждый первый ход ведёт к победе. Посмотри, какой цвет быстрее откроет остальные.' }
];

export const COLORS = {
  A: { fill: 0x18bfb1, css: '#18bfb1', ink: '#076961', texture: 'candy-mint', name: 'Мятный', symbol: '○' },
  B: { fill: 0xff536c, css: '#ff536c', ink: '#a01d3f', texture: 'candy-coral', name: 'Коралловый', symbol: '△' },
  C: { fill: 0x9c5af3, css: '#9c5af3', ink: '#623197', texture: 'candy-violet', name: 'Сиреневый', symbol: '□' },
  D: { fill: 0xf2bb18, css: '#f2bb18', ink: '#876208', texture: 'candy-lemon', name: 'Жёлтый', symbol: '◇' },
  E: { fill: 0x6ebdff, css: '#6ebdff', name: 'Голубой', symbol: '+' },
  F: { fill: 0xff96ce, css: '#ff96ce', name: 'Розовый', symbol: '=' }
};
