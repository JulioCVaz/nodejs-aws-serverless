import { ApiGatewayManagementApi } from "aws-sdk";

export class InvoiceWSService {
    private apiGatewayManagementApi: ApiGatewayManagementApi

    constructor(apiGatewayManagementApi: ApiGatewayManagementApi) {
        this.apiGatewayManagementApi = apiGatewayManagementApi
    }

    async sendData(connectionId: string, data: string): Promise<boolean> {
        try {
            await this.apiGatewayManagementApi.getConnection({
                ConnectionId: connectionId
            }).promise()

            await this.apiGatewayManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: data
            }).promise()

            return true
        } catch (error) {
            return false
        }
    }

    sendInvoiceStatus(transactionId: string, connectionId: string, status: string) {
        const postData = JSON.stringify({
            transactionId: transactionId,
            status: status
        })

        return this.sendData(connectionId, postData)
    }

    async disconnectClient(connectionId: string): Promise<boolean> {
        try {
            await this.apiGatewayManagementApi.getConnection({
                ConnectionId: connectionId
            }).promise()

            await this.apiGatewayManagementApi.deleteConnection({
                ConnectionId: connectionId
            }).promise()

            return true
        } catch (error) {
            return false
        }
    }
}