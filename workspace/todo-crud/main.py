from fastapi import FastAPI
app = FastAPI()
todos = []
@app.post('/todos')
def create(todo: dict): todos.append(todo); return todo
@app.get('/todos')
def list(): return todos