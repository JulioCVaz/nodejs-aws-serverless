import { Context, S3Event, S3EventRecord } from "aws-lambda"
import { ApiGatewayManagementApi, DynamoDB, EventBridge, S3 } from "aws-sdk"
import * as AWSXRay from "aws-xray-sdk"
import { InvoiceTransactionRepository, InvoiceTransactionStatus } from "/opt/nodejs/invoiceTransaction"
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection"
import { InvoiceFile, InvoiceRepository } from "/opt/nodejs/invoiceRepository"

AWSXRay.captureAWS(require('aws-sdk'))

const invoicesDdb = process.env.INVOICE_DDB!
const invoiceWSApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6) // remove /ws:// prefix
const auditBusName = process.env.AUDIT_BUS_NAME!

const s3Client = new S3()
const ddbClient = new DynamoDB.DocumentClient()
const apiGatewayManagementApi = new ApiGatewayManagementApi({
    endpoint: invoiceWSApiEndpoint
})
const eventBridgeClient = new EventBridge()

const invoiceTransactionRepository = new InvoiceTransactionRepository(ddbClient, invoicesDdb)
const invoiceWSService = new InvoiceWSService(apiGatewayManagementApi)
const invoiceRepository = new InvoiceRepository(ddbClient, invoicesDdb)

export async function handler(event: S3Event, context: Context): Promise<void> {
    console.log(event)

    const promises: Promise<void>[] = []
    
    event.Records.forEach((record) => {
        promises.push(processRecord(record))
    })

    await Promise.all(promises)

    return
}

async function processRecord(record: S3EventRecord) {
    const key = record.s3.object.key // transactionId

    try {
        const invoiceTransaction = await invoiceTransactionRepository.getInvoiceTransaction(key)
        if (invoiceTransaction.transactionStatus === InvoiceTransactionStatus.GENERATED) {
            await Promise.all(
                [
                    invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId, InvoiceTransactionStatus.RECEIVED),
                    invoiceTransactionRepository.updateInvoiceTransaction(key, InvoiceTransactionStatus.RECEIVED)
                ]
            )
        } else {
            await invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId, invoiceTransaction.transactionStatus)
            console.error(`Non valid transaction status`)
            return
        }
        
        const object = await s3Client.getObject({
            Key: key,
            Bucket: record.s3.bucket.name
        }).promise()

        const invoice = JSON.parse(object.Body!.toString('utf-8')) as InvoiceFile
        console.log(invoice)

        if (invoice.invoiceNumber.length >= 5) {
            const createInvoicePromise = invoiceRepository.create({
                pk: `#invoice_${invoice.customerName}`,
                sk: invoice.invoiceNumber,
                ttl: 0,
                totalValue: invoice.totalValue,
                productId: invoice.productId,
                quantity: invoice.quantity,
                transactionId: key,
                createdAt: Date.now()
            })
    
            const deleteObjectPromise = s3Client.deleteObject({
                Key: key,
                Bucket: record.s3.bucket.name
            }).promise()
    
            const updateInvoicePromise = await invoiceTransactionRepository.updateInvoiceTransaction(key, InvoiceTransactionStatus.PROCESSED)
            
            const sendStatusPromise = await invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId, InvoiceTransactionStatus.PROCESSED)
            
            await Promise.all([createInvoicePromise, deleteObjectPromise, updateInvoicePromise, sendStatusPromise])
        } else {
            console.error(`Invoice import failed - non valid invoice number - TransactionId: ${key}`)

            const putEventPromise = eventBridgeClient.putEvents({
                Entries: [
                    {
                        Source: 'app.invoice',
                        EventBusName: auditBusName,
                        DetailType: 'invoice',
                        Time: new Date(),
                        Detail: JSON.stringify({
                           errorDetail: 'FAIL_NO_INVOICE_NUMBER',
                           info: {
                            invoiceKey: key,
                            customerName: invoice.customerName
                           }
                        })
                    }
                ]
            }).promise()

            const sendStatusPromise = invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId,
                InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER)
 
            const updateInvoicePromise = invoiceTransactionRepository.updateInvoiceTransaction(key,
             InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER)
 
            await Promise.all([sendStatusPromise, updateInvoicePromise, putEventPromise])
        }

        await invoiceWSService.disconnectClient(invoiceTransaction.connectionId)
    } catch (error) {
        console.log((<Error>error).message)
    }
}
