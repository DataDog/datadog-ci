exports.handler = async () => {
  console.log(JSON.stringify({message: 'Lambda e2e test invoked'}))

  return {statusCode: 200, body: JSON.stringify({ok: true})}
}
