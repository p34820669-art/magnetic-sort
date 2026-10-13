// Strings are bottom -> top. Empty strings are the two free containers.
export const LEVELS = [
  { name: 'Первый сбор', lesson: 'gather', tubes: ['AABB', 'AABB', '', ''],
    tip: 'Нажми на △. Все открытые треугольники соберутся сами. Четыре одинаковых — готово!' },
  { name: 'Неполная партия', lesson: 'partial', tubes: ['AABB', 'BBAA', '', ''],
    tip: 'Собери △. Две конфеты останутся ждать: остальные спрятаны под ○.' },
  { name: 'Магнит-приёмник', lesson: 'receiver', tubes: ['A', 'ABBB', 'B', 'AA', '', ''],
    tip: 'Нажми на △ в № 2. Они полетят к △ в № 3: одноцветная стопка — приёмник.' },
  { name: 'Три цвета', lesson: 'practice', tubes: ['ABCC', 'BCAB', 'CAAB', '', ''],
    tip: 'Открывай спрятанные цвета. Магнит отмечает приёмник, стрелки показывают путь.' },
  { name: 'Береги место', lesson: 'space', tubes: ['ABCA', 'CBBA', 'ACBC', '', ''],
    tip: 'Попробуй начать с ○. Затем ищи ход, который откроет одноцветный приёмник.' },
  { name: 'Порядок важен', lesson: 'challenge', tubes: ['BDCA', 'CDAA', 'CDBB', 'ADBC', '', ''],
    tip: 'Четыре цвета, два пустых места. Планируй следующий сбор. Ошибку можно отменить.' }
];

export const COLORS = {
  A: { fill: 0x18bfb1, css: '#18bfb1', ink: '#076961', texture: 'candy-mint', name: 'Мятный', symbol: '○' },
  B: { fill: 0xff536c, css: '#ff536c', ink: '#a01d3f', texture: 'candy-coral', name: 'Коралловый', symbol: '△' },
  C: { fill: 0x9c5af3, css: '#9c5af3', ink: '#623197', texture: 'candy-violet', name: 'Сиреневый', symbol: '□' },
  D: { fill: 0xf2bb18, css: '#f2bb18', ink: '#876208', texture: 'candy-lemon', name: 'Жёлтый', symbol: '◇' },
  E: { fill: 0x6ebdff, css: '#6ebdff', name: 'Голубой', symbol: '+' },
  F: { fill: 0xff96ce, css: '#ff96ce', name: 'Розовый', symbol: '=' }
};
