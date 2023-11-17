import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import { ApiGatewayManagementApi, DynamoDB, S3 } from "aws-sdk"
import * as AWSXRay from "aws-xray-sdk"
import { v4 as uuid } from 'uuid'
import { InvoiceTransactionStatus, InvoiceTransactionRepository } from "/opt/nodejs/invoiceTransaction"
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection"


AWSXRay.captureAWS(require('aws-sdk'))

const invoicesDdb = process.env.INVOICE_DDB!
const bucketName = process.env.BUCKET_NAME!
const invoiceWSApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6) // remove /ws:// prefix

const s3Client = new S3()
const ddbClient = new DynamoDB.DocumentClient()
const apiGatewayManagementApi = new ApiGatewayManagementApi({
    endpoint: invoiceWSApiEndpoint
})

const invoiceTransactionRepository = new InvoiceTransactionRepository(ddbClient, invoicesDdb)
const invoiceWSService = new InvoiceWSService(apiGatewayManagementApi)

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    console.log(event)

    const lambdaRequestId = context.awsRequestId
    // ws connection id
    const connectionId = event.requestContext.connectionId!
    console.log(`ConnectionId: ${connectionId} - lambda RequestId: ${lambdaRequestId}`)

    const key = uuid()
    const expiresIn = 300 // 5 minutes in seconds
    const signedUrl = await s3Client.getSignedUrlPromise('putObject', {
        Bucket: bucketName,
        Key: key,
        Expires: expiresIn
    })

    // create invoice transaction
    const timestamp = Date.now()
    const ttl = ~~(timestamp / 1000 + 60 * 2)

    await invoiceTransactionRepository.createInvoiceTransaction({
        pk: "#transaction",
        sk: key,
        ttl,
        requestId: lambdaRequestId,
        timestamp,
        transactionStatus: InvoiceTransactionStatus.GENERATED,
        expiresIn,
        connectionId,
        endpoint: invoiceWSApiEndpoint
    })
    // send URL back to WS connected client
    const postData = JSON.stringify({
        url: signedUrl,
        expires: expiresIn,
        transactionId: key
    })

    await invoiceWSService.sendData(connectionId, postData)

    return {
        statusCode: 200,
        body: "OK" 
    }
}