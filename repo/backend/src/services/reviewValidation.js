'use strict';

const MAX_TAGS = 5;
const MAX_BODY = 1000;

function validate(review) {
  const errors = [];
  if (!review.orderLineItemId) errors.push('orderLineItemId required');
  if (!review.orderId)         errors.push('orderId required');
  if (!review.reviewerId)      errors.push('reviewerId required');
  if (!review.deviceId)        errors.push('deviceId required');

  const r = Number(review.rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) errors.push('rating must be integer 1..5');

  const tags = review.tags || [];
  if (!Array.isArray(tags)) errors.push('tags must be an array');
  else if (tags.length > MAX_TAGS) errors.push(`tags exceed max (${MAX_TAGS})`);

  if (review.body != null && String(review.body).length > MAX_BODY) {
    errors.push(`body exceeds ${MAX_BODY} characters`);
  }
  return errors;
}

module.exports = { validate, MAX_TAGS, MAX_BODY };
