const $ = (selector) => document.querySelector(selector);

const elements = {
    table: $('#users-table'),
    status: $('#status-message'),
    createResult: $('#create-result'),
    lookupResult: $('#lookup-result'),
    healthResult: $('#health-result'),
    helloResult: $('#hello-result'),
    searchResult: $('#search-result'),
    responseCode: $('#response-code'),
    responseMessage: $('#response-message'),
    editDialog: $('#edit-dialog'),
    editForm: $('#edit-form'),
};

async function request(path, options = {}) {
    const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const rawBody = await response.text();
    let data = rawBody;

    try {
        data = JSON.parse(rawBody);
    } catch {
        // Keep non-JSON responses, such as Express HTML errors, unchanged.
    }

    updateResponse(response.status, rawBody);
    if (!response.ok) {
        const errorMessage = typeof data === 'object' && data !== null && data.message
            ? data.message
            : rawBody || `Request failed (${response.status})`;
        const error = new Error(errorMessage);
        error.status = response.status;
        throw error;
    }
    return data;
}

function updateResponse(statusCode, rawBody) {
    elements.responseCode.textContent = statusCode;
    elements.responseCode.classList.toggle('response-success', statusCode >= 200 && statusCode < 300);
    elements.responseCode.classList.toggle('response-error', statusCode >= 400);
    elements.responseMessage.textContent = rawBody || '(empty response body)';
}

function setStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.style.color = isError ? '#b65c49' : '';
}

function showResult(element, message, isError = false) {
    element.textContent = message;
    element.style.color = isError ? '#b65c49' : '';
}

function userFromResponse(data) {
    return data.result || data.Result || data;
}

function renderUsers(users) {
    if (!users.length) {
        elements.table.innerHTML = '<tr><td class="empty-state" colspan="4">No users yet. Add the first one above.</td></tr>';
        return;
    }

    elements.table.innerHTML = users.map((user) => `
    <tr>
      <td>#${user.id}</td>
      <td class="name-cell">${escapeHtml(user.name)}</td>
      <td class="age-cell">${user.age} years</td>
      <td>
        <div class="action-group">
          <button class="table-action" data-action="edit" data-id="${user.id}" type="button">Edit</button>
          <button class="table-action delete" data-action="delete" data-id="${user.id}" type="button">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
    }[character]));
}

async function loadUsers() {
    try {
        const data = await request('/users');
        renderUsers(data.result || []);
        setStatus(`${(data.result || []).length} user${(data.result || []).length === 1 ? '' : 's'} in directory`);
    } catch (error) {
        elements.table.innerHTML = `<tr><td class="empty-state" colspan="4">${escapeHtml(error.message)}</td></tr>`;
        setStatus(error.message, true);
    }
}

$('#health-button').addEventListener('click', async () => {
    try {
        const data = await request('/health');
        showResult(elements.healthResult, `${data.status} - all good`);
        setStatus('API is healthy');
    } catch (error) {
        showResult(elements.healthResult, error.message, true);
        setStatus(error.message, true);
    }
});

$('#hello-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#hello-name').value.trim();
    try {
        const data = await request(`/hello/${encodeURIComponent(name)}`);
        showResult(elements.helloResult, data.message);
    } catch (error) {
        showResult(elements.helloResult, error.message, true);
    }
});

$('#search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#search-name').value.trim();
    try {
        const data = await request(`/search?name=${encodeURIComponent(name)}`);
        showResult(elements.searchResult, data.message);
    } catch (error) {
        showResult(elements.searchResult, error.message, true);
    }
});

$('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#create-name').value.trim();
    const age = Number($('#create-age').value);
    try {
        const data = await request('/users', {
            method: 'POST',
            body: JSON.stringify({ name, age }),
        });
        const user = userFromResponse(data);
        showResult(elements.createResult, `Added ${user.name} as user #${user.id}`);
        event.target.reset();
        await loadUsers();
    } catch (error) {
        showResult(elements.createResult, error.message, true);
    }
});

$('#lookup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = Number($('#lookup-id').value);
    try {
        const data = await request(`/users/${id}`);
        const user = userFromResponse(data);
        if (!user || user.name === undefined || user.age === undefined) {
            throw new Error('User not found');
        }
        showResult(elements.lookupResult, `${user.name}, age ${user.age}`);
    } catch (error) {
        showResult(elements.lookupResult, error.message, true);
    }
});

$('#refresh-button').addEventListener('click', loadUsers);

elements.table.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);

    if (button.dataset.action === 'delete') {
        if (!window.confirm(`Delete user #${id}?`)) return;
        try {
            await request(`/users/${id}`, { method: 'DELETE' });
            setStatus(`User #${id} deleted`);
            await loadUsers();
        } catch (error) {
            setStatus(error.message, true);
        }
        return;
    }

    const data = await request(`/users/${id}`);
    const user = userFromResponse(data);
    $('#edit-id').value = user.id;
    $('#edit-id-label').textContent = `#${user.id}`;
    $('#edit-name').value = '';
    $('#edit-age').value = '';
    elements.editDialog.showModal();
});

elements.editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = Number($('#edit-id').value);
    const name = $('#edit-name').value.trim();
    const ageValue = $('#edit-age').value;
    const updates = {};
    if (name) updates.name = name;
    if (ageValue) updates.age = Number(ageValue);

    if (!Object.keys(updates).length) {
        setStatus('Add a name or age before saving', true);
        return;
    }

    try {
        await request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
        elements.editDialog.close();
        setStatus(`User #${id} updated`);
        await loadUsers();
    } catch (error) {
        setStatus(error.message, true);
    }
});

loadUsers();
