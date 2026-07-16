// Reglas de palabras clave por grupo.
// groupId: '*' aplica a TODOS los grupos donde esté el bot.
// Para limitar a un grupo específico, usa su ID real, ej: '120363012345678901@g.us'
// (ese ID se ve en la consola de Railway cuando el bot recibe un mensaje del grupo).

const keywordRules = [
  {
    groupId: "*",
    keyword: "box",
    response: "Voy",
  },
  // Agrega más reglas aquí, por ejemplo:
  // { groupId: '*', keyword: 'llego', response: 'Perfecto, te espero' },
];

module.exports = { keywordRules };
