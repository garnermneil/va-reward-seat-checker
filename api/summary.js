const { createSummary, defaultUrl, getAnalysisOptions } = require('../index');

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const options = getAnalysisOptions(
      Number(request.query.slotLength),
      request.query.startDate,
      request.query.endDate,
    );
    const summary = await createSummary({ url: defaultUrl, ...options });
    response.status(200).json(summary);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
};
