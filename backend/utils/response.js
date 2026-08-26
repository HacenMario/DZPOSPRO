// backend/utils/response.js
// Helpers to standardise the API envelope across controllers.
// Success:   { success: true, data, message? }
// List:      { success: true, data: [...], total, page, limit, totalPages }
// Error:     { success: false, message, errors? }

const successResponse = (res, data = null, message = null, status = 200) => {
    const body = { success: true };
    if (message !== null) body.message = message;
    body.data = data;
    return res.status(status).json(body);
};

const createdResponse = (res, data = null, message = null) => successResponse(res, data, message, 201);

const paginatedResponse = (res, { data, total, page, limit }) => {
    const p = parseInt(page, 10) || 1;
    const l = parseInt(limit, 10) || 20;
    return res.json({
        success: true,
        data,
        total,
        page: p,
        limit: l,
        totalPages: l > 0 ? Math.ceil(total / l) : 0
    });
};

const errorResponse = (res, status, message, errors = null) => {
    const body = { success: false, message };
    if (errors) body.errors = errors;
    return res.status(status).json(body);
};

module.exports = {
    successResponse,
    createdResponse,
    paginatedResponse,
    errorResponse
};
