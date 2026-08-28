// backend/utils/pagination.js
// Small helper to parse ?page&limit from query strings consistently.
const parsePagination = (query) => {
    let page = parseInt(query.page, 10);
    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 200) limit = 200; // hard cap
    return {
        page,
        limit,
        skip: (page - 1) * limit
    };
};

module.exports = { parsePagination };
