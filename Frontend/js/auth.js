document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  // Login
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      try {
        const response = await fetch('https://edutest-0y0z.onrender.com/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('role', data.role);
          localStorage.setItem('name', data.name);
          localStorage.setItem('userId', data.userId);

          if (data.role.toLowerCase() === 'faculty') {
            window.location.href = 'dashboard.html';
          } else {
            window.location.href = 'student.html';
          }
        } else {
          alert(data.error || 'Invalid login credentials');
        }
      } catch (err) {
        alert('Server unreachable. Please verify that the backend is running.');
      }
    });
  }

  // Registration with Comprehensive Academic Profile Payload
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const role = document.getElementById('regRole').value;
      const payload = {
        name: document.getElementById('regName').value.trim(),
        email: document.getElementById('regEmail').value.trim(),
        phone: document.getElementById('regPhone').value.trim(),
        password: document.getElementById('regPassword').value,
        role: role
      };

      if (role === 'student') {
        payload.roll_number = document.getElementById('regRollNo').value.trim();
        payload.department = document.getElementById('regDept').value.trim();
        payload.year_of_study = document.getElementById('regYear').value;
        payload.semester = document.getElementById('regSem').value.trim();
        payload.division_batch = document.getElementById('regBatch').value.trim();
      } else {
        payload.employee_id = document.getElementById('regEmpId').value.trim();
        payload.department = document.getElementById('regFacultyDept').value.trim();
        payload.designation = document.getElementById('regDesignation').value;
        payload.specialization = document.getElementById('regSpecialization').value.trim();
      }

      try {
        const response = await fetch('https://edutest-0y0z.onrender.com/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
          alert('Registration successful! Please sign in with your credentials.');
          window.location.reload();
        } else {
          alert(data.error || 'Registration failed');
        }
      } catch (err) {
        alert('Server unreachable. Please verify backend is running.');
      }
    });
  }
});