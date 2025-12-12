/**
 * Predefined prompt templates for fallback
 */
const promptTemplates = [
    {
        category: 'daily_life',
        en: 'What did you eat for breakfast today? Why did you choose it?',
        ja: '今日の朝食は何を食べましたか？詳しく説明して、なぜそれを選んだのか理由も教えてください。'
    },
    {
        category: 'culture',
        en: 'Is there a tradition or custom from your home country that you want more people to know about?',
        ja: '母国で、「これは知ってほしい！」と思う伝統や文化はありますか？'
    },
    {
        category: 'opinions',
        en: 'Do you prefer studying in the morning or at night? Which works better for you?',
        ja: '勉強するなら、朝と夜どちらのほうが集中できますか？'
    },
    {
        category: 'storytelling',
        en: 'What\'s a small mistake or accident that turned out to be a good memory later on?',
        ja: 'ちょっとした失敗が、あとでいい思い出になったことはありますか？'
    },
    {
        category: 'collaboration',
        en: 'Let\'s imagine the perfect student café together! What kind of place would it be?',
        ja: '一緒に理想の学生カフェを考えてみましょう！どんなお店だったら行きたくなりますか？'
    }
];

module.exports = {
    promptTemplates
};
